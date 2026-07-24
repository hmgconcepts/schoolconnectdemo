-- ============================================================================
-- SCHOOL CONNECT — RUNTIME HELPER RPCs PACK (standalone for EXISTING projects)
-- ============================================================================
-- These functions complete the client↔server contract so NO secondary SQL is
-- ever needed. Already inside complete-schema.sql v12.5+ as Section 18 — run
-- THIS file only on projects installed from v12.1–v12.4. Idempotent: safe to
-- re-run. Uses CREATE OR REPLACE + IF NOT EXISTS throughout.
--
-- Adds: sc_current_role · lookup_login_email · notif_mark_read · table_sizes ·
-- purge_old · submit_admission · extract_admission · generate_timetable ·
-- cbt_import_backup (+ admissions photo_url/data/extracted columns).
-- All client call sites keep working fallbacks — this pack is pure hardening.
-- ============================================================================

-- ============================================================================
-- SECTION 18: RUNTIME HELPER RPCs (v12.5 — additive contract completion)
-- ============================================================================
-- Every RPC the CLIENT code references now exists server-side, so a bare
-- complete-schema install is 100% self-sufficient — no secondary SQL, no
-- manual dashboard functions, ever. Each call site keeps its client-side
-- fallback, so this pack is pure hardening (never a breaking change).
-- (Also ships as database/runtime-helper-rpcs.sql for EXISTING projects.)

-- 18.0 admissions column-gap fix — the apply form + admissions console use
-- photo_url / data / extracted, which older schemas silently lacked (the
-- client's graceful fallback masked it; fresh v12.x DBs dropped those keys).
alter table public.admissions
  add column if not exists photo_url text,
  add column if not exists data jsonb,
  add column if not exists extracted boolean not null default false;

-- 18.1 sc_current_role() — one-call {role,status,full_name,...} for the shell
create or replace function public.sc_current_role()
returns json language plpgsql stable security definer set search_path=public as $$
declare p record;
begin
  select * into p from public.profiles where id = auth.uid() limit 1;
  if not found then return null; end if;
  return row_to_json(p);
end $$;
revoke execute on function public.sc_current_role() from public, anon;
grant  execute on function public.sc_current_role() to authenticated;

-- 18.2 lookup_login_email(identifier → email) — login with admission/staff no or phone
create or replace function public.lookup_login_email(p_identifier text)
returns text language plpgsql stable security definer set search_path=public as $$
declare ident text := btrim(coalesce(p_identifier,'')); em text;
begin
  if ident = '' then return null; end if;
  select p.email into em from public.profiles p
   where lower(p.email) = lower(ident) and coalesce(p.email,'') <> '' limit 1;
  if em is not null then return em; end if;
  select p.email into em from public.profiles p
   where p.phone = ident and coalesce(p.email,'') <> '' limit 1;
  if em is not null then return em; end if;
  select pr.email into em from public.students s join public.profiles pr on pr.id = s.user_id
   where lower(s.admission_no) = lower(ident) and coalesce(pr.email,'') <> '' limit 1;
  if em is not null then return em; end if;
  select coalesce(pr.email, stf.email) into em
    from public.staff stf left join public.profiles pr on pr.id = stf.user_id
   where (lower(stf.staff_no) = lower(ident) or stf.phone = ident)
     and coalesce(coalesce(pr.email, stf.email),'') <> ''
   order by case when pr.email is null then 1 else 0 end limit 1;
  return em; -- null when no account matches (client shows "No account found")
end $$;
revoke execute on function public.lookup_login_email(text) from public;
grant  execute on function public.lookup_login_email(text) to anon, authenticated;

-- 18.3 notif_mark_read(id) — atomic read-by append of the caller's uid
create or replace function public.notif_mark_read(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.notifications
     set read_by = case
       when read_by is null then array[auth.uid()]
       when auth.uid() = any(read_by) then read_by
       else array_append(read_by, auth.uid()) end
   where id = p_id;
end $$;
revoke execute on function public.notif_mark_read(uuid) from public, anon;
grant  execute on function public.notif_mark_read(uuid) to authenticated;

-- 18.4 table_sizes() — storage console overview (rows: per-table + TOTAL_DATABASE_USED)
create or replace function public.table_sizes()
returns table(table_name text, pretty text, row_estimate bigint, total_bytes bigint)
language plpgsql stable security definer set search_path=public as $$
begin
  return query
  select s.table_name, s.pretty, s.row_estimate, s.total_bytes from (
    select c.relname::text as table_name,
           pg_size_pretty(pg_total_relation_size(c.oid)) as pretty,
           greatest(c.reltuples,0)::bigint as row_estimate,
           pg_total_relation_size(c.oid) as total_bytes
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
    union all
    select 'TOTAL_DATABASE_USED',
           pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)),0)),
           greatest(coalesce(sum(greatest(c.reltuples,0)),0),0)::bigint,
           coalesce(sum(pg_total_relation_size(c.oid)),0)::bigint
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  ) s order by s.total_bytes desc;
end $$;
revoke execute on function public.table_sizes() from public, anon;
grant  execute on function public.table_sizes() to authenticated;

-- 18.5 purge_old(table, days) — storage console purge, admin-only, strict whitelist
create or replace function public.purge_old(p_table text, p_days integer)
returns integer language plpgsql security definer set search_path=public as $$
declare r text; n integer := 0;
  allowed text[] := array['activity_log','cbt_results','notifications','reading_scores','attendance_checkins'];
begin
  select lower(role) into r from public.profiles where id = auth.uid();
  if coalesce(r,'') not in ('super_admin','admin','principal','proprietor','head_teacher') then
    raise exception 'purge_old: admin role required';
  end if;
  if not (p_table = any(allowed)) then
    raise exception 'purge_old: % is not purgeable from the storage console (allowed: %)', p_table, array_to_string(allowed, ', ');
  end if;
  execute format('delete from public.%I where created_at < now() - make_interval(days => $1)', p_table)
     using greatest(coalesce(p_days, 180), 1);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.purge_old(text, integer) from public, anon;
grant  execute on function public.purge_old(text, integer) to authenticated;

-- 18.6 submit_admission(payload) — public apply form write path
create or replace function public.submit_admission(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
  if coalesce(p_payload->>'full_name','') = '' then
    return jsonb_build_object('ok',false,'error','Applicant name is required');
  end if;
  insert into public.admissions
    (full_name, dob, gender, parent_name, parent_email, parent_phone,
     applying_for_class, notes, photo_url, data, status)
  values
    (p_payload->>'full_name', nullif(p_payload->>'dob','')::date,
     nullif(p_payload->>'gender',''), nullif(p_payload->>'parent_name',''),
     nullif(p_payload->>'parent_email',''), nullif(p_payload->>'parent_phone',''),
     nullif(p_payload->>'applying_for_class',''), left(coalesce(p_payload->>'notes',''), 2000),
     nullif(p_payload->>'photo_url',''), p_payload, 'submitted')
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm); -- client falls back to a direct insert
end $$;
revoke execute on function public.submit_admission(jsonb) from public;
grant  execute on function public.submit_admission(jsonb) to anon, authenticated;

-- 18.7 extract_admission(id) — Accept & Extract: admit the applicant as a student
create or replace function public.extract_admission(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; sid uuid; r text;
begin
  select lower(role) into r from public.profiles where id = auth.uid();
  if coalesce(r,'') not in ('super_admin','admin','principal','proprietor','head_teacher') then
    return jsonb_build_object('ok',false,'error','extract_admission: admin role required');
  end if;
  select * into a from public.admissions where id = p_id;
  if not found then return jsonb_build_object('ok',false,'error','Application not found'); end if;
  if coalesce(a.extracted,false) then
    return jsonb_build_object('ok',false,'error','This applicant was already enrolled');
  end if;
  insert into public.students
    (full_name, class, gender, date_of_birth, guardian_name, guardian_phone,
     guardian_email, photo_url, status)
  values
    (a.full_name, coalesce(a.applying_for_class,''), coalesce(a.gender,''), a.dob,
     coalesce(a.parent_name,''), coalesce(a.parent_phone,''), coalesce(a.parent_email,''),
     coalesce(nullif(a.data->>'photo_url',''), a.photo_url), 'active')
  returning id into sid; -- admission_no is auto-generated by trg_sc_generate_admission_no
  update public.admissions set extracted = true, status = 'accepted' where id = p_id;
  return jsonb_build_object('ok', true, 'student_id', sid);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.extract_admission(uuid) from public, anon;
grant  execute on function public.extract_admission(uuid) to authenticated;

-- 18.8 generate_timetable(class, session, term, periods/day) — auto weekday planner
create or replace function public.generate_timetable(p_class text, p_session text default '', p_term text default '', p_periods_per_day integer default 6)
returns jsonb language plpgsql security definer set search_path=public as $$
declare req record; inserted integer := 0;
  days text[] := array['Monday','Tuesday','Wednesday','Thursday','Friday'];
  ppd integer := least(greatest(coalesce(p_periods_per_day,6),1),12);
  bag text[] := '{}'; idx integer := 0; d integer; per integer; tries integer;
  candidate text; last_subj text; i integer;
begin
  for req in select subject, teacher, periods_per_week
               from public.timetable_requirements
              where class = p_class order by periods_per_week desc loop
    for i in 1..greatest(coalesce(req.periods_per_week,0),0) loop
      bag := bag || (req.subject || '||' || coalesce(req.teacher,''));
    end loop;
  end loop;
  if array_length(bag,1) is null then
    return jsonb_build_object('ok',false,'error','No timetable requirements defined for class "'||coalesce(p_class,'')||'" — add subjects on the Timetable Requirements card first.');
  end if;
  delete from public.timetable
   where class = p_class and coalesce(session,'') = coalesce(p_session,'') and coalesce(term,'') = coalesce(p_term,'');
  while array_length(bag,1) is not null loop
    for d in 1..5 loop
      exit when array_length(bag,1) is null;
      last_subj := '';
      for per in 1..ppd loop
        exit when array_length(bag,1) is null;
        idx := idx % array_length(bag,1) + 1; tries := 0;
        candidate := bag[idx];
        -- avoid the same subject in two consecutive periods of a day (when alternatives exist)
        while split_part(candidate,'||',1) = last_subj and tries < array_length(bag,1) loop
          idx := idx % array_length(bag,1) + 1; candidate := bag[idx]; tries := tries + 1;
        end loop;
        insert into public.timetable (class, day, period, subject, teacher, session, term)
        values (p_class, days[d], per::text, split_part(candidate,'||',1),
                nullif(split_part(candidate,'||',2),''), coalesce(p_session,''), coalesce(p_term,''));
        inserted := inserted + 1; last_subj := split_part(candidate,'||',1);
        bag := (select array_agg(u.x order by u.o) from unnest(bag) with ordinality as u(x,o) where u.o <> idx);
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', inserted, 'days', 5, 'periods_per_day', ppd);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.generate_timetable(text, text, text, integer) from public, anon;
grant  execute on function public.generate_timetable(text, text, text, integer) to authenticated;

-- 18.9 cbt_import_backup(payload) — teacher-side import of offline exam backups.
-- Same server-authoritative, shuffle-safe grading as cbt_submit_v2 but WITHOUT
-- the exam-window / attempt-limit gates (backups reach the teacher after the
-- sitting). Idempotent on client_ref like the live path.
create or replace function public.cbt_import_backup(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  e record; r record; rid uuid; sid uuid; n int; taken int := 0;
  score numeric := 0; total numeric := 0; cc int := 0; wc int := 0; sc int := 0;
  ans jsonb; q jsonb; i int := 0; a text; k text; mark numeric;
  ref text := nullif(p_payload->>'client_ref','');
begin
  select * into e from public.cbt_exams where id = (p_payload->>'exam_id')::uuid;
  if not found then return jsonb_build_object('saved', false, 'error', 'Exam not found'); end if;
  if ref is not null then
    select * into r from public.cbt_results where exam_id = e.id and client_ref = ref limit 1;
    if found then
      return jsonb_build_object('saved', true, 'duplicate', true, 'result_id', r.id, 'score', r.score, 'total', r.total, 'percent', r.percent,
        'correct_count', r.correct_count, 'wrong_count', r.wrong_count, 'skipped_count', r.skipped_count,
        'cert_code', r.cert_code, 'title', e.title, 'release_results', e.release_results, 'report_column', e.report_column);
    end if;
  end if;
  for ans in select * from jsonb_array_elements(coalesce(p_payload->'answers_data','[]'::jsonb)) loop
    q := (case when jsonb_typeof(e.csv_data)='array' and jsonb_array_length(e.csv_data)>0 then e.csv_data when jsonb_typeof(e.questions)='array' and jsonb_array_length(e.questions)>0 then e.questions else '[]'::jsonb end)
          -> (case when coalesce(ans->>'index','') ~ '^[0-9]+$' then (ans->>'index')::int else i end);
    mark := coalesce(nullif(q->>'mark','')::numeric, 1); total := total + mark;
    a := coalesce(ans->>'answer', ans #>> '{}', '');
    k := coalesce(q->>'answer', q->>'correct', q->>'correct_answer', '');
    if a is null or trim(a) = '' then sc := sc + 1;
    elsif k <> '' and lower(trim(a)) = lower(trim(k)) then score := score + mark; cc := cc + 1;
    else wc := wc + 1; end if;
    i := i + 1;
  end loop;
  sid := nullif(p_payload->>'student_id','')::uuid;
  n := case when total > 0 then round(score/total*100)::int else 0 end;
  if nullif(p_payload->>'student_id_ref','') is not null then
    select count(*) into taken from public.cbt_results where exam_id = e.id and student_id_ref = p_payload->>'student_id_ref';
  end if;
  begin
    insert into public.cbt_results(
      exam_id, student_id, student_name, student_class, student_id_ref, student_type,
      score, total, percent, correct_count, wrong_count, skipped_count,
      attempt_number, time_taken, violations, violation_log, answers_data, cert_code, client_ref
    ) values (
      e.id, sid, coalesce(p_payload->>'student_name','Anonymous'), coalesce(p_payload->>'student_class', e.class),
      coalesce(p_payload->>'student_id_ref',''), coalesce(p_payload->>'student_type', e.exam_mode),
      score, total::int, n, cc, wc, sc,
      taken + 1, coalesce((p_payload->>'time_taken')::int,0), coalesce((p_payload->>'violations')::int,0),
      coalesce(p_payload->'violation_log','[]'::jsonb), p_payload->'answers_data',
      case when e.certificate_enabled then 'CERT-'||upper(substr(md5(random()::text),1,8)) else '' end,
      ref
    ) returning id into rid;
  exception when unique_violation then
    select * into r from public.cbt_results where exam_id = e.id and client_ref = ref limit 1;
    if found then
      return jsonb_build_object('saved', true, 'duplicate', true, 'result_id', r.id, 'score', r.score, 'total', r.total, 'percent', r.percent,
        'correct_count', r.correct_count, 'wrong_count', r.wrong_count, 'skipped_count', r.skipped_count,
        'cert_code', r.cert_code, 'title', e.title, 'release_results', e.release_results, 'report_column', e.report_column);
    end if;
    return jsonb_build_object('saved', false, 'error', 'Duplicate submission conflict');
  end;
  return jsonb_build_object('saved', true, 'result_id', rid, 'score', score, 'total', total, 'percent', n,
    'correct_count', cc, 'wrong_count', wc, 'skipped_count', sc,
    'cert_code', (select cert_code from public.cbt_results where id = rid), 'title', e.title,
    'release_results', e.release_results, 'report_column', e.report_column);
exception when others then
  return jsonb_build_object('saved', false, 'error', sqlerrm);
end $$;
revoke execute on function public.cbt_import_backup(jsonb) from public, anon;
grant  execute on function public.cbt_import_backup(jsonb) to authenticated;
