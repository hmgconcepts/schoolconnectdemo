-- ============================================================================
-- SCHOOL CONNECT — CBT 1000-CONCURRENT SCALE PACK (v1, 2026-07-23)
-- ----------------------------------------------------------------------------
-- PURPOSE: guarantee the CBT exam room survives 1000 students writing the
-- same exam AT THE SAME TIME on Supabase FREE tier. 100% ADD-ONLY and
-- idempotent — safe to run on any live project (v12.x schemas), safe to
-- re-run, removes nothing, breaks nothing (the original cbt_get_public_exam /
-- cbt_submit keep working untouched; the exam page simply prefers the v2
-- functions when they exist and falls back when they don't).
--
-- WHAT THIS PACK ADDS
--   1. Hot-path indexes — the exam-code lookup and the results-per-exam scans
--      become index hits (no seq scans while 1000 students start together).
--   2. cbt_results.client_ref + a partial UNIQUE index → IDEMPOTENT SUBMITS:
--      a student (or the auto-resubmit queue) can safely send the same
--      attempt twice after a network drop; the second call returns the FIRST
--      saved result instead of creating a duplicate row.
--   3. cbt_get_public_exam_v2 — the v1 slim payload (answers/explanations are
--      ALREADY stripped server-side) PLUS everything a busy exam hall needs:
--      server_now (client clocks sync to the SERVER — no "my time jumped"),
--      start_at/close_at (client clamps its deadline to the exam window),
--      instructions, anti_cheat_config (integrity rules now actually reach
--      the exam room), attempt_limit, randomise/select_count (v1 omitted
--      them, so open exams silently skipped randomisation), pass_mark,
--      release_results and certificate_enabled.
--   4. cbt_submit_v2 — same authoritative SERVER-SIDE grading as v1, plus:
--        • idempotent retries via client_ref (see 2)
--        • attempt_limit enforcement for identified candidates
--        • closed-window enforcement (120 s server grace absorbs the final
--          submit storm and clock drift)
--        • returns the REAL release_results flag (v1 never returned it, so
--          "Results will be released by your teacher" could not trigger)
--        • correct/wrong/skipped counts computed on the server, not trusted
--          from the browser
--
-- CAPACITY MATH (Supabase free tier): each candidate costs exactly ONE
-- indexed read at start + ONE row insert at submit (zero calls in between —
-- the exam runs entirely on the device). 1000 candidates pressing Start in
-- the same 3–4 seconds ≈ 300 indexed reads/s — trivial for Postgres. Egress
-- is the only number worth watching: a 40-question text-only paper ≈ 25 KB
-- → 1000 candidates ≈ 25 MB (0.5% of the free 5 GB). Keep images as Storage
-- URLs, never base64 inside questions (see docs/04-FEATURE-EXPLANATIONS.md).
-- ============================================================================

set search_path = public;

-- ── 1) HOT-PATH INDEXES ─────────────────────────────────────────────────────
-- cbt_get_public_exam*(p_code) matches upper(code) — give it an expression index.
create index if not exists cbt_exams_upper_code_idx on public.cbt_exams (upper(code));
-- Results lookups (teacher results view, push-to-report, attempt counting).
create index if not exists cbt_results_exam_idx        on public.cbt_results (exam_id);
create index if not exists cbt_results_exam_time_idx   on public.cbt_results (exam_id, submitted_at desc);
create index if not exists cbt_results_student_ref_idx on public.cbt_results (exam_id, student_id_ref);

-- ── 2) IDEMPOTENT SUBMISSIONS ───────────────────────────────────────────────
alter table public.cbt_results add column if not exists client_ref text;
-- One saved attempt per (exam, client_ref). Partial index keeps it tiny and
-- leaves every pre-existing row (client_ref NULL) untouched.
create unique index if not exists cbt_results_client_ref_uidx
  on public.cbt_results (exam_id, client_ref)
  where client_ref is not null and client_ref <> '';

-- ── 3) cbt_get_public_exam_v2 ───────────────────────────────────────────────
create or replace function public.cbt_get_public_exam_v2(p_code text)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare e record; qs jsonb;
begin
  select * into e from public.cbt_exams
   where upper(code)=upper(trim(p_code)) and is_open=true and is_archived=false limit 1;
  if not found then return null; end if;
  if e.start_at is not null and now()<e.start_at then
    return jsonb_build_object('wait',true,'start_at',e.start_at,'title',e.title,'server_now',now());
  end if;
  if e.close_at is not null and now()>e.close_at then
    return jsonb_build_object('closed',true,'server_now',now());
  end if;
  -- Slim question payload: answers/explanations never leave the server
  -- (same guarantee as v1), _orig_index keeps server-side grading aligned
  -- after client-side shuffle/select.
  select coalesce(jsonb_agg((q-'correct'-'correct_answer'-'answer'-'explanation')||jsonb_build_object('_orig_index',ord-1) order by ord),'[]'::jsonb)
    into qs
    from jsonb_array_elements((case when jsonb_typeof(e.csv_data)='array' and jsonb_array_length(e.csv_data)>0 then e.csv_data when jsonb_typeof(e.questions)='array' and jsonb_array_length(e.questions)>0 then e.questions else '[]'::jsonb end)) with ordinality x(q,ord);
  return jsonb_build_object(
    'id',e.id,'code',e.code,'title',e.title,'subject',e.subject,'class',e.class,
    'term',e.term,'session',e.session,'assessment_type',e.assessment_type,
    'duration',coalesce(nullif(e.duration_min,0),e.duration,45),
    'questions',qs,'_questions',qs,
    'report_column',e.report_column,'max_score',e.max_score,'exam_mode',e.exam_mode,
    -- NEW over v1 (all additive):
    'server_now',now(),'start_at',e.start_at,'close_at',e.close_at,
    'instructions',e.instructions,'anti_cheat_config',e.anti_cheat_config,
    'attempt_limit',e.attempt_limit,'randomise',e.randomise,'select_count',e.select_count,
    'pass_mark',e.pass_mark,'release_results',e.release_results,
    'certificate_enabled',e.certificate_enabled
  );
end $$;

-- ── 4) cbt_submit_v2 ────────────────────────────────────────────────────────
create or replace function public.cbt_submit_v2(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  e record; r record; rid uuid; sid uuid; n int; taken int := 0;
  score numeric := 0; total numeric := 0; cc int := 0; wc int := 0; sc int := 0;
  ans jsonb; q jsonb; i int := 0; a text; k text; mark numeric;
  ref text := nullif(p_payload->>'client_ref','');
  dup jsonb;
begin
  select * into e from public.cbt_exams where id=(p_payload->>'exam_id')::uuid;
  if not found then return jsonb_build_object('saved',false,'error','Exam not found'); end if;

  -- Closed-window enforcement (120 s server grace absorbs clock drift + the
  -- end-of-exam submit storm; the client clamps its own deadline earlier).
  if e.close_at is not null and now() > e.close_at + interval '120 seconds' then
    return jsonb_build_object('saved',false,'error','closed','message','This exam has closed. Your answers were not recorded.');
  end if;

  -- IDEMPOTENT RETRY: we have seen this exact attempt before → hand back the
  -- ORIGINAL result, never a duplicate row.
  if ref is not null then
    select * into r from public.cbt_results where exam_id=e.id and client_ref=ref limit 1;
    if found then
      return jsonb_build_object('saved',true,'duplicate',true,'result_id',r.id,'score',r.score,'total',r.total,'percent',r.percent,
        'correct_count',r.correct_count,'wrong_count',r.wrong_count,'skipped_count',r.skipped_count,
        'cert_code',r.cert_code,'release_results',e.release_results,'report_column',e.report_column);
    end if;
    -- Attempt limit (only enforce for identified candidates).
    if nullif(p_payload->>'student_id_ref','') is not null and coalesce(e.attempt_limit,0) > 0 then
      select count(*) into taken from public.cbt_results where exam_id=e.id and student_id_ref=p_payload->>'student_id_ref';
      if taken >= e.attempt_limit then
        return jsonb_build_object('saved',false,'error','attempts_exhausted','message','Attempt limit ('||e.attempt_limit||') reached for this exam.');
      end if;
    end if;
  end if;

  -- AUTHORITATIVE SERVER-SIDE GRADING (identical rule to v1): the browser's
  -- own score display is a courtesy; only this score is stored.
  for ans in select * from jsonb_array_elements(coalesce(p_payload->'answers_data','[]'::jsonb)) loop
    q := (case when jsonb_typeof(e.csv_data)='array' and jsonb_array_length(e.csv_data)>0 then e.csv_data when jsonb_typeof(e.questions)='array' and jsonb_array_length(e.questions)>0 then e.questions else '[]'::jsonb end)
          -> (case when coalesce(ans->>'index','') ~ '^[0-9]+$' then (ans->>'index')::int else i end);
    mark := coalesce(nullif(q->>'mark','')::numeric,1); total := total + mark;
    a := coalesce(ans->>'answer', ans #>> '{}', '');
    k := coalesce(q->>'answer', q->>'correct', q->>'correct_answer', '');
    if a is null or trim(a) = '' then sc := sc + 1;
    elsif k <> '' and lower(trim(a)) = lower(trim(k)) then score := score + mark; cc := cc + 1;
    else wc := wc + 1; end if;
    i := i + 1;
  end loop;

  sid := nullif(p_payload->>'student_id','')::uuid;
  n := case when total>0 then round(score/total*100)::int else 0 end;

  begin
    insert into public.cbt_results(
      exam_id,student_id,student_name,student_class,student_id_ref,student_type,
      score,total,percent,correct_count,wrong_count,skipped_count,
      attempt_number,time_taken,violations,violation_log,answers_data,cert_code,client_ref
    ) values (
      e.id,sid,coalesce(p_payload->>'student_name','Anonymous'),coalesce(p_payload->>'student_class',e.class),
      coalesce(p_payload->>'student_id_ref',''),coalesce(p_payload->>'student_type',e.exam_mode),
      score,total::int,n,cc,wc,sc,
      taken+1,coalesce((p_payload->>'time_taken')::int,0),coalesce((p_payload->>'violations')::int,0),
      coalesce(p_payload->'violation_log','[]'::jsonb),p_payload->'answers_data',
      case when e.certificate_enabled then 'CERT-'||upper(substr(md5(random()::text),1,8)) else '' end,
      ref
    ) returning id into rid;
  exception when unique_violation then
    -- Lost a race with our own parallel retry → return the row that won.
    select * into r from public.cbt_results where exam_id=e.id and client_ref=ref limit 1;
    if found then
      return jsonb_build_object('saved',true,'duplicate',true,'result_id',r.id,'score',r.score,'total',r.total,'percent',r.percent,
        'correct_count',r.correct_count,'wrong_count',r.wrong_count,'skipped_count',r.skipped_count,
        'cert_code',r.cert_code,'release_results',e.release_results,'report_column',e.report_column);
    end if;
    return jsonb_build_object('saved',false,'error','Duplicate submission conflict');
  end;

  return jsonb_build_object('saved',true,'result_id',rid,'score',score,'total',total,'percent',n,
    'correct_count',cc,'wrong_count',wc,'skipped_count',sc,'cert_code',
    (select cert_code from public.cbt_results where id=rid),
    'release_results',e.release_results,'report_column',e.report_column);
exception when others then return jsonb_build_object('saved',false,'error',sqlerrm);
end $$;

-- ── GRANTS + POSTGREST RELOAD ───────────────────────────────────────────────
grant execute on function public.cbt_get_public_exam_v2(text) to anon, authenticated;
grant execute on function public.cbt_submit_v2(jsonb)         to anon, authenticated;

notify pgrst, 'reload schema';
select pg_notify('pgrst','reload schema');

analyze public.cbt_exams;
analyze public.cbt_results;

select 'CBT 1000-concurrent scale pack installed ✅ (v2 exam fetch + idempotent submit + hot-path indexes)' as status;
