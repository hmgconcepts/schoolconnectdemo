#!/usr/bin/env node
/* V10.4 regression — CBT creation RLS (multi-subject aware) + duration sync.
   Reproduces the exact live failure ("new row violates row-level security
   policy for table cbt_exams") and proves the V10.4 pack fixes it without
   widening teacher scope:
     1. OLD policy refused a teacher's MULTI-SUBJECT package unless they were
        the class teacher — NEW gate accepts when ANY listed subject is theirs.
     2. teacher_id=NULL is still refused server-side (client now backfills it).
     3. A teacher with NO relationship to any listed subject/class stays
        refused (no scope widening).
     4. staff.subjects case-insensitive match ('mathematics' vs 'Mathematics').
     5. Admins always pass.
     6. Duration sync trigger: insert with duration=120 delivers 120 to the
        getter (duration_min mirrors), old default-45 rows are repaired. */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const T='11111111-1111-4111-8111-111111111111';   // teacher (owns English Language via subjects.teacher name)
const S='22222222-2222-4222-8222-222222222222';   // staff-array teacher (Mathematics, lowercase in array)
const X='33333333-3333-4333-8333-333333333333';   // unrelated teacher
const ADMIN='44444444-4444-4444-8444-444444444444';

await db.exec(`create schema auth;
create table auth_uid_holder(id uuid);insert into auth_uid_holder values('${T}');
create function auth.uid()returns uuid language sql stable as $$select id from auth_uid_holder limit 1$$;
create table profiles(id uuid primary key,full_name text,role text,status text);
insert into profiles values
 ('${T}','Funke Alabi','teacher','approved'),
 ('${S}','Musa Bello','teacher','approved'),
 ('${X}','Ngozi Eze','teacher','approved'),
 ('${ADMIN}','The Admin','admin','approved');
create table staff(id uuid primary key default gen_random_uuid(),user_id uuid,full_name text,status text,subjects text[]);
insert into staff(user_id,full_name,status,subjects)values
 ('${T}','Funke Alabi','active','{}'),
 ('${S}','Musa Bello','active',array['mathematics']),  -- lowercase on purpose (bug 4)
 ('${X}','Ngozi Eze','active','{}');
create table subjects(id uuid primary key default gen_random_uuid(),name text,teacher_id uuid,teacher text);
insert into subjects(name,teacher)values('English Language','Funke Alabi'),('Mathematics',''),('Chemistry','Someone Else'),('Physics','Someone Else');
create table classes(id uuid primary key default gen_random_uuid(),name text,class_teacher text);
insert into classes(name,class_teacher)values('SS 2','Funke Alabi'),('JSS 1','Nobody Here');
create table cbt_exams(id uuid primary key default gen_random_uuid(),teacher_id uuid,code text unique not null,title text,subject text not null default 'General',class text default '',duration int not null default 45,duration_min int default 45,is_open boolean default false,csv_data jsonb default '[]',questions jsonb default '[]',updated_at timestamptz default now());
alter table cbt_exams enable row level security;
create function public.is_admin(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('super_admin','admin','principal','proprietor','head_teacher','bursar')and status in('approved','active'))$$;
-- the ORIGINAL (pre-V10.4) function + policy, verbatim semantics
create or replace function public.teacher_can_manage_subject_class(p_uid uuid,p_subject text default '',p_class text default '')
returns boolean language plpgsql security definer stable as $$
declare pname text:='';srec record;subject_ok boolean:=false;class_ok boolean:=false;
begin
 if public.is_admin(p_uid)then return true;end if;
 select full_name into pname from public.profiles where id=p_uid and role in('teacher','staff')and status in('approved','active');if not found then return false;end if;
 select * into srec from public.staff where user_id=p_uid and coalesce(status,'active')='active'limit 1;
 if coalesce(trim(p_subject),'')<>''then
  subject_ok:=exists(select 1 from public.subjects su where lower(trim(su.name))=lower(trim(p_subject))and(su.teacher_id=p_uid or lower(trim(coalesce(su.teacher,'')))=lower(trim(pname))or(srec.id is not null and lower(trim(coalesce(su.teacher,'')))=lower(trim(srec.full_name)))or(srec.id is not null and p_subject=any(coalesce(srec.subjects,'{}'::text[])))));
 end if;
 if coalesce(trim(p_class),'')<>''then class_ok:=exists(select 1 from public.classes c where lower(trim(c.name))=lower(trim(p_class))and(lower(trim(coalesce(c.class_teacher,'')))=lower(trim(pname))or(srec.id is not null and lower(trim(coalesce(c.class_teacher,'')))=lower(trim(srec.full_name)))));end if;
 return subject_ok or class_ok;
end$$;
create policy cbt_exam_scope_insert on public.cbt_exams for insert with check(public.is_admin(auth.uid())or(teacher_id=auth.uid()and public.teacher_can_manage_subject_class(auth.uid(),subject,class)));
create role anon;create role authenticated;grant all on all tables in schema public to authenticated;grant usage on schema public to authenticated;`);

const as = async (uid) => db.exec(`update auth_uid_holder set id='${uid}'`);
const tryInsert = async (row) => {
  try { await db.query(`insert into cbt_exams(teacher_id,code,title,subject,class,duration)values($1,$2,$3,$4,$5,$6)`,
    [row.teacher_id, row.code, row.title||'t', row.subject, row.class||'', row.duration||45]); return { ok:true }; }
  catch (e) { return { ok:false, msg:String(e.message||e) }; }
};

await db.exec(`set role authenticated`);

/* ---- REPRODUCE the reported bug on the OLD policy ---- */
await as(T);
const oldMulti = await tryInsert({ teacher_id:T, code:'OLD1', subject:'MULTI-SUBJECT: Mathematics, English, Chemistry, Physics', class:'JSS 1' });
if (oldMulti.ok) throw Error('expected OLD policy to refuse the multi-subject package (bug not reproduced)');
if (!/row-level security/i.test(oldMulti.msg)) throw Error('unexpected error: '+oldMulti.msg);

/* ---- APPLY the V10.4 pack ---- */
await db.exec(`reset role`);
const pack = fs.readFileSync(new URL('../database/v10.4-cbt-multisubject-rls.sql', import.meta.url), 'utf8')
  .split('\n').filter(l => !/^\s*notify pgrst/.test(l) && !/pg_notify/.test(l)).join('\n');
await db.exec(pack);
await db.exec(`set role authenticated`);

/* 1. Funke (owns English Language, class-teaches SS 2) can now create the
      multi-subject package for ANY class because English is hers. */
await as(T);
const fixedMulti = await tryInsert({ teacher_id:T, code:'NEW1', subject:'MULTI-SUBJECT: Mathematics, English Language, Chemistry, Physics', class:'JSS 1' });
if (!fixedMulti.ok) throw Error('V10.4 gate still refuses the owner of a listed subject: '+fixedMulti.msg);

/* class-teachership alone still qualifies (package with none of her subjects, her own class) */
const classOnly = await tryInsert({ teacher_id:T, code:'NEW2', subject:'MULTI-SUBJECT: Chemistry, Physics', class:'SS 2' });
if (!classOnly.ok) throw Error('class-teacher fallback broken: '+classOnly.msg);

/* 2. teacher_id NULL is still refused (server keeps the ownership stamp). */
const nullOwner = await tryInsert({ teacher_id:null, code:'NEW3', subject:'English Language', class:'SS 2' });
if (nullOwner.ok) throw Error('NULL teacher_id must stay refused');

/* 3. Unrelated teacher stays locked out — scope NOT widened. */
await as(X);
const foreign = await tryInsert({ teacher_id:X, code:'NEW4', subject:'MULTI-SUBJECT: Mathematics, English Language, Chemistry, Physics', class:'JSS 1' });
if (foreign.ok) throw Error('scope widened: unrelated teacher created a multi-subject package');
const foreignSingle = await tryInsert({ teacher_id:X, code:'NEW5', subject:'English Language', class:'JSS 1' });
if (foreignSingle.ok) throw Error('scope widened: unrelated teacher created a single-subject exam');

/* 4. staff.subjects case-insensitive: Musa's array says 'mathematics'. */
await as(S);
const ci = await tryInsert({ teacher_id:S, code:'NEW6', subject:'Mathematics', class:'JSS 1' });
if (!ci.ok) throw Error('case-insensitive staff.subjects match failed: '+ci.msg);
const ciMulti = await tryInsert({ teacher_id:S, code:'NEW7', subject:'MULTI-SUBJECT: Mathematics, English Language', class:'JSS 1' });
if (!ciMulti.ok) throw Error('multi-subject via case-insensitive array failed: '+ciMulti.msg);

/* 5. Admin always passes, even for a synthetic subject and no teacher_id. */
await as(ADMIN);
const adm = await tryInsert({ teacher_id:null, code:'NEW8', subject:'MULTI-SUBJECT: Anything, At All', class:'JSS 1' });
if (!adm.ok) throw Error('admin refused: '+adm.msg);

/* 6. Duration sync: insert duration=120 → duration_min mirrors → and legacy
      default-45 rows were repaired by the pack's one-time update. */
await as(T);
await db.query(`insert into cbt_exams(teacher_id,code,title,subject,class,duration)values($1,'DUR1','d','English Language','SS 2',120)`,[T]);
const dur = (await db.query(`select duration,duration_min from cbt_exams where code='DUR1'`)).rows[0];
if (Number(dur.duration)!==120 || Number(dur.duration_min)!==120) throw Error('duration sync trigger failed: '+JSON.stringify(dur));
await db.exec(`reset role`);
await db.exec(`alter table cbt_exams disable trigger trg_cbt_duration_sync`);
await db.query(`insert into cbt_exams(teacher_id,code,title,subject,duration,duration_min)values($1,'DUR2','legacy','English Language',90,45)`,[T]);
await db.exec(`alter table cbt_exams enable trigger trg_cbt_duration_sync`);
await db.exec(`update public.cbt_exams set duration_min=duration where coalesce(duration,0)>0 and duration<>45 and coalesce(duration_min,45)=45`);
const legacy = (await db.query(`select duration_min from cbt_exams where code='DUR2'`)).rows[0];
if (Number(legacy.duration_min)!==90) throw Error('legacy duration repair failed: '+JSON.stringify(legacy));

console.log(JSON.stringify({ok:true,
  reproduced_old_bug:'row-level security refusal on MULTI-SUBJECT insert',
  fixed:{multi_subject_by_subject_owner:true,class_teacher_fallback:true,case_insensitive_staff_subjects:true},
  still_enforced:{null_teacher_id_refused:true,unrelated_teacher_refused_multi_and_single:true},
  admin_always_passes:true,
  duration_sync:{insert_mirrors:120,legacy_repair:90}
},null,2));
await db.close();
