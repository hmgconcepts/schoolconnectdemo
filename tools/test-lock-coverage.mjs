#!/usr/bin/env node
/* V10.9 regression — report-lock FULL coverage + privacy scoping.
   Proves:
     1. Report lock blanks affective_traits / psychomotor_traits /
        report_comments / student_term_metrics for the locked family
        (V10.8 already proved report_scores/report_cards/results/cbt_results).
     2. PRIVACY: an unrelated student can NO LONGER read another student's
        traits/comments (the old policies allowed any authenticated user!).
     3. Parent of a locked child is blanked too; unlock restores; staff always
        read.
     4. Fee doctor: finds duplicates, unlinked, non-positive, overpayment,
        no-period rows; heal path recomputes. */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const ADMIN='11111111-1111-4111-8111-111111111111';
const PARENT='22222222-2222-4222-8222-222222222222';
const STUD_U='33333333-3333-4333-8333-333333333333';
const OTHER_U='55555555-5555-4555-8555-555555555555';
const KID='44444444-4444-4444-8444-444444444444';
const OTHER_KID='66666666-6666-4666-8666-666666666666';

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth_uid_holder(id uuid);insert into auth_uid_holder values('${ADMIN}');
create function auth.uid()returns uuid language sql stable as $$select id from auth_uid_holder limit 1$$;
create function auth.jwt()returns jsonb language sql stable as $$select '{}'::jsonb$$;
create function auth.role()returns text language sql stable as $$select 'authenticated'$$;
create table profiles(id uuid primary key,full_name text,role text,status text);
insert into profiles values('${ADMIN}','Admin','admin','approved'),('${PARENT}','Parent','parent','approved'),('${STUD_U}','Student','student','approved'),('${OTHER_U}','Other Student','student','approved');
create table parent_child(id uuid primary key default gen_random_uuid(),parent_id uuid,student_id uuid);
create table students(id uuid primary key,user_id uuid,guardian_email text,full_name text,class text,arm text,department text,admission_no text,status text default 'active',portal_locked boolean default false,portal_lock_message text default '',report_locked boolean default false,report_lock_message text default '',locked_by uuid,locked_at timestamptz,opening_arrears numeric default 0,opening_arrears_note text default '');
insert into students(id,user_id,full_name,class)values('${KID}','${STUD_U}','Locked Kid','JSS 1'),('${OTHER_KID}','${OTHER_U}','Other Kid','JSS 1');
insert into parent_child(parent_id,student_id)values('${PARENT}','${KID}');
create table academic_periods(id int primary key,term text,session text,is_current boolean);insert into academic_periods values(1,'Third Term','2025/2026',true);
create table class_fee_structure(id uuid primary key default gen_random_uuid(),class text,arm text default '',department text default '',term text default 'Current Term',session text default '',tuition numeric default 0,total numeric default 0,exam_fee numeric default 0,development numeric default 0,transport numeric default 0,boarding numeric default 0,other_fee numeric default 0,discount numeric default 0,currency text default '₦',due_date date,note text default '',active boolean default true,updated_at timestamptz default now());
create table fee_payments(id uuid primary key default gen_random_uuid(),student_id uuid,student_name text,amount_paid numeric,fee_total numeric,balance numeric,term text default '',session text default '',total_overridden boolean default false,created_at timestamptz default now());
create table module_records(id uuid primary key default gen_random_uuid(),module text,title text,amount numeric,status text,audience text default 'private',data jsonb default '{}');
create table affective_traits(id uuid primary key default gen_random_uuid(),student_id uuid,term text,session text,ratings jsonb default '{}');
create table psychomotor_traits(id uuid primary key default gen_random_uuid(),student_id uuid,term text,session text,ratings jsonb default '{}');
create table report_comments(id uuid primary key default gen_random_uuid(),student_id uuid,term text,session text,class_teacher_comment text);
create table student_term_metrics(id uuid primary key default gen_random_uuid(),student_id uuid,term text,session text,height_cm numeric);
alter table affective_traits enable row level security;alter table psychomotor_traits enable row level security;
alter table report_comments enable row level security;alter table student_term_metrics enable row level security;
insert into affective_traits(student_id,ratings)values('${KID}','{"punctuality":5}');
insert into psychomotor_traits(student_id,ratings)values('${KID}','{"handwriting":4}');
insert into report_comments(student_id,class_teacher_comment)values('${KID}','Excellent term.');
insert into student_term_metrics(student_id,height_cm)values('${KID}',150);
create function public.is_admin(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('admin','super_admin','principal','proprietor','head_teacher','bursar')and status in('approved','active'))$$;
create function public.is_staff(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('admin','super_admin','principal','proprietor','head_teacher','bursar','staff','teacher')and status in('approved','active'))$$;
create function public.is_parent_of(uid uuid,child uuid)returns boolean language sql security definer stable as $$select exists(select 1 from parent_child where parent_id=uid and student_id=child)$$;
grant usage on schema public to authenticated;grant all on all tables in schema public to authenticated;
-- the OLD wide-open policies V10.9 replaces
create policy "affective_traits_read" on public.affective_traits for select using (auth.role()='authenticated');
create policy "psychomotor_traits_read" on public.psychomotor_traits for select using (auth.role()='authenticated');
create policy "report_comments_read" on public.report_comments for select using (auth.role()='authenticated');
create policy metrics_family_read on public.student_term_metrics for select using (true);
create table report_scores(id uuid primary key default gen_random_uuid(),student_id uuid,student_id_ref text default '');
create table report_cards(id uuid primary key default gen_random_uuid(),student_id uuid);
create policy "v7_report_scores_read_stub" on public.report_scores for select using(true);`);

const strip=t=>t.split('\n').filter(l=>!/^\s*notify pgrst/.test(l)&&!/pg_notify/.test(l)).join('\n');
await db.exec(strip(fs.readFileSync(new URL('../database/v10.7-fee-locks-arrears.sql',import.meta.url),'utf8'))
  .replace(/alter table public\.students add column[^;]*;/g,'')
  .replace(/drop policy if exists "v7_report_scores_read"[\s\S]*?\);/,'')
  .replace(/drop policy if exists "v7_report_cards_family"[\s\S]*?\);/,''));
await db.exec(strip(fs.readFileSync(new URL('../database/v10.8-fee-recompute.sql',import.meta.url),'utf8'))
  .replace(/drop policy if exists results_scope_select[\s\S]*?\);/,'')
  .replace(/drop policy if exists cbt_result_scope_select[\s\S]*?\);/,''));
await db.exec(strip(fs.readFileSync(new URL('../database/v10.9-lock-coverage.sql',import.meta.url),'utf8')));
await db.exec(strip(fs.readFileSync(new URL('../database/v10.9b-fee-doctor.sql',import.meta.url),'utf8')));

const as=async uid=>db.exec(`update auth_uid_holder set id='${uid}'`);
const count=async t=>(await db.query(`select count(*)::int n from ${t}`)).rows[0].n;
const T=['affective_traits','psychomotor_traits','report_comments','student_term_metrics'];

/* 2. PRIVACY (pre-lock): the unrelated student must see NOTHING of Locked Kid's data. */
await db.exec(`set role authenticated`);
await as(OTHER_U);
for (const t of T) if (await count(t) !== 0) throw Error('privacy hole: unrelated student reads '+t);
/* own family reads fine pre-lock */
await as(STUD_U);
for (const t of T) if (await count(t) !== 1) throw Error('own student blocked pre-lock on '+t);
await as(PARENT);
for (const t of T) if (await count(t) !== 1) throw Error('parent blocked pre-lock on '+t);

/* 1+3. Lock → both student AND parent blanked on all four surfaces. */
await db.exec(`reset role`);
await as(ADMIN);
await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'report',true,'Fees outstanding.')`);
await db.exec(`set role authenticated`);
for (const who of [STUD_U, PARENT]) {
  await as(who);
  for (const t of T) if (await count(t) !== 0) throw Error((who===PARENT?'PARENT':'student')+' still reads '+t+' while report-locked');
}
/* staff unaffected */
await db.exec(`reset role`);
await as(ADMIN);
for (const t of T) if (await count(t) !== 1) throw Error('staff blocked on '+t);
/* unlock restores for both */
await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'report',false,'')`);
await db.exec(`set role authenticated`);
for (const who of [STUD_U, PARENT]) {
  await as(who);
  for (const t of T) if (await count(t) !== 1) throw Error('unlock did not restore '+t);
}
await db.exec(`reset role`);

/* 4. Fee doctor findings */
await as(ADMIN);
await db.query(`insert into fee_payments(student_id,student_name,amount_paid,fee_total,term,session)values('${KID}','Locked Kid',10000,50000,'Third Term','2025/2026')`);
await db.query(`insert into fee_payments(student_id,student_name,amount_paid,term,session)values('${KID}','Locked Kid',10000,'Third Term','2025/2026')`); // duplicate same day
await db.query(`insert into fee_payments(student_name,amount_paid)values('Typed Freehand',5000)`);                                                          // unlinked + no period? (no student → skips per-student checks)
await db.query(`insert into fee_payments(student_id,student_name,amount_paid,term,session)values('${OTHER_KID}','Other Kid',0,'Third Term','2025/2026')`);   // non-positive
await db.query(`insert into fee_payments(student_id,student_name,amount_paid)values('${OTHER_KID}','Other Kid',7000)`);                                      // missing period
await db.query(`insert into fee_payments(student_id,student_name,amount_paid,fee_total,term,session)values('${OTHER_KID}','Other Kid',90000,20000,'Third Term','2025/2026')`); // overpayment
const doc=(await db.query(`select public.sc_fee_ledger_doctor(false) d`)).rows[0].d;
if(!doc.ok) throw Error('doctor failed: '+JSON.stringify(doc));
const kinds=new Set((doc.issues||[]).map(i=>i.kind));
for (const k of ['duplicate','unlinked','non_positive','no_period','overpayment'])
  if(!kinds.has(k)) throw Error('doctor missed kind: '+k+' | got '+[...kinds].join(','));
const healed=(await db.query(`select public.sc_fee_ledger_doctor(true) d`)).rows[0].d;
if(!healed.ok||healed.healed_terms<1) throw Error('doctor heal failed: '+JSON.stringify(healed));
/* non-staff refused */
await as(STUD_U);
const deny=(await db.query(`select public.sc_fee_ledger_doctor(false) d`)).rows[0].d;
if(deny.ok) throw Error('doctor must be staff-only');

console.log(JSON.stringify({ok:true,
 privacy:{unrelated_student_blocked_on_all_four:true},
 lock_coverage:{student_and_parent_blanked:T,staff_unaffected:true,unlock_restores:true},
 fee_doctor:{kinds_found:[...kinds].sort(),healed_terms:healed.healed_terms,staff_only:true}},null,2));
await db.close();
