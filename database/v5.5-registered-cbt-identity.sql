-- School Connect V5.5 focused registered CBT identity upgrade. Back up first.
-- V5.5 registered-exam identity: admission number resolves the official student.
create or replace function public.cbt_get_public_exam_v6(p_code text,p_admission_no text default '')
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare base jsonb;e record;s record;wanted text:=regexp_replace(upper(coalesce(p_admission_no,'')),'[^A-Z0-9]','','g');roster_count int:=0;
begin
 base:=public.cbt_get_public_exam_v5(p_code);if coalesce((base->>'ok')::boolean,false)=false then return base;end if;
 select * into e from public.cbt_exams where id=(base->>'id')::uuid;
 if lower(coalesce(e.exam_mode,'open'))='registered'then
  if wanted=''then return (base-'questions'-'_questions')||jsonb_build_object('ok',false,'error','admission_required','message','This examination is restricted to registered students. Enter your admission number; your official name and class will be loaded automatically.','identity_mode','registered');end if;
  select * into s from public.students where regexp_replace(upper(coalesce(admission_no,'')),'[^A-Z0-9]','','g')=wanted and coalesce(status,'active')in('active','approved')limit 1;
  if not found then return (base-'questions'-'_questions')||jsonb_build_object('ok',false,'error','invalid_admission','message','No active registered student matches that admission number. Contact the school—do not type a name manually.','identity_mode','registered');end if;
  select count(*)into roster_count from public.cbt_roster where exam_id=e.id;
  if roster_count>0 and not exists(select 1 from public.cbt_roster r where r.exam_id=e.id and regexp_replace(upper(r.student_id_ref),'[^A-Z0-9]','','g')=wanted)then return (base-'questions'-'_questions')||jsonb_build_object('ok',false,'error','not_on_roster','message','This registered student is not on the roster for this examination.','identity_mode','registered');end if;
  return base||jsonb_build_object('identity_mode','registered','candidate',jsonb_build_object('id',s.id,'admission_no',s.admission_no,'full_name',s.full_name,'class',trim(coalesce(s.class,'')||' '||coalesce(s.arm,''))));
 end if;
 if wanted<>''then select * into s from public.students where regexp_replace(upper(coalesce(admission_no,'')),'[^A-Z0-9]','','g')=wanted limit 1;end if;
 return base||jsonb_build_object('identity_mode','open','candidate',case when s.id is null then null else jsonb_build_object('id',s.id,'admission_no',s.admission_no,'full_name',s.full_name,'class',trim(coalesce(s.class,'')||' '||coalesce(s.arm,'')))end);
end$$;

create or replace function public.cbt_submit_v6(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e record;s record;wanted text;roster_count int;payload jsonb:=p_payload;
begin
 select * into e from public.cbt_exams where id=(p_payload->>'exam_id')::uuid;if not found then return jsonb_build_object('saved',false,'error','exam_not_found','message','Exam not found.','engine_version','v5.1.0');end if;
 if lower(coalesce(e.exam_mode,'open'))='registered'then
  wanted:=regexp_replace(upper(coalesce(p_payload->>'student_id_ref','')),'[^A-Z0-9]','','g');if wanted=''then return jsonb_build_object('saved',false,'error','admission_required','message','Admission number is required.','engine_version','v5.1.0');end if;
  select * into s from public.students where regexp_replace(upper(coalesce(admission_no,'')),'[^A-Z0-9]','','g')=wanted and coalesce(status,'active')in('active','approved')limit 1;if not found then return jsonb_build_object('saved',false,'error','invalid_admission','message','Registered student not found.','engine_version','v5.1.0');end if;
  select count(*)into roster_count from public.cbt_roster where exam_id=e.id;if roster_count>0 and not exists(select 1 from public.cbt_roster r where r.exam_id=e.id and regexp_replace(upper(r.student_id_ref),'[^A-Z0-9]','','g')=wanted)then return jsonb_build_object('saved',false,'error','not_on_roster','message','Student is not on this exam roster.','engine_version','v5.1.0');end if;
  payload:=payload||jsonb_build_object('student_id',s.id,'student_id_ref',s.admission_no,'student_name',s.full_name,'student_class',trim(coalesce(s.class,'')||' '||coalesce(s.arm,'')),'student_type','registered');
 elsif coalesce(p_payload->>'student_id_ref','')<>''then
  wanted:=regexp_replace(upper(p_payload->>'student_id_ref'),'[^A-Z0-9]','','g');select * into s from public.students where regexp_replace(upper(coalesce(admission_no,'')),'[^A-Z0-9]','','g')=wanted limit 1;if found then payload:=payload||jsonb_build_object('student_id',s.id,'student_id_ref',s.admission_no,'student_name',s.full_name,'student_class',trim(coalesce(s.class,'')||' '||coalesce(s.arm,'')));end if;
 end if;
 return public.cbt_submit_v5(payload);
end$$;
revoke execute on function public.cbt_get_public_exam_v6(text,text)from public;grant execute on function public.cbt_get_public_exam_v6(text,text)to anon,authenticated;
revoke execute on function public.cbt_submit_v6(jsonb)from public;grant execute on function public.cbt_submit_v6(jsonb)to anon,authenticated;
notify pgrst,'reload schema';select pg_notify('pgrst','reload schema');
select 'School Connect V5.5 registered CBT identity installed ✅'as status;
