#!/usr/bin/env node
/* V10.7 regression — fee-discipline locks + manual opening arrears.
   Proves:
     1. sc_set_student_locks: admin bulk-locks portal/report; non-admin refused.
     2. sc_my_access_state: locked student sees portal_locked + message;
        parent of a locked child too; staff never locked.
     3. RLS: a report-locked family CANNOT select report_scores/report_cards
        rows; unlocking restores; staff unaffected.
     4. Opening arrears: sc_student_fee_state adds them to arrears/total_due
        with a labelled row; clearing (0) removes them; V10.3 override still
        wins over everything. */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const ADMIN='11111111-1111-4111-8111-111111111111';
const PARENT='22222222-2222-4222-8222-222222222222';
const STUD_U='33333333-3333-4333-8333-333333333333';
const KID='44444444-4444-4444-8444-444444444444';

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth_uid_holder(id uuid);insert into auth_uid_holder values('${ADMIN}');
create function auth.uid()returns uuid language sql stable as $$select id from auth_uid_holder limit 1$$;
create function auth.jwt()returns jsonb language sql stable as $$select '{}'::jsonb$$;
create table profiles(id uuid primary key,full_name text,role text,status text);
insert into profiles values('${ADMIN}','Admin','admin','approved'),('${PARENT}','Parent','parent','approved'),('${STUD_U}','Student','student','approved');
create table parent_child(id uuid primary key default gen_random_uuid(),parent_id uuid,student_id uuid);
create table students(id uuid primary key,user_id uuid,guardian_email text,full_name text,class text,arm text,department text,admission_no text,status text default 'active');
insert into students(id,user_id,full_name,class,arm)values('${KID}','${STUD_U}','Locked Kid','JSS 1','A');
insert into parent_child(parent_id,student_id)values('${PARENT}','${KID}');
create table academic_periods(id int primary key,term text,session text,is_current boolean);insert into academic_periods values(1,'Third Term','2025/2026',true);
create table class_fee_structure(id uuid primary key default gen_random_uuid(),class text,arm text default '',department text default '',term text default 'Current Term',session text default '',tuition numeric default 0,exam_fee numeric default 0,development numeric default 0,transport numeric default 0,boarding numeric default 0,other_fee numeric default 0,discount numeric default 0,total numeric default 0,currency text default '₦',due_date date,note text default '',active boolean default true,updated_at timestamptz default now());
insert into class_fee_structure(class,term,session,tuition,total)values('JSS 1','Third Term','2025/2026',100000,100000);
create table fee_payments(id uuid primary key default gen_random_uuid(),student_id uuid,amount_paid numeric,fee_total numeric,balance numeric,term text,session text,total_overridden boolean default false,created_at timestamptz default now());
create table module_records(id uuid primary key default gen_random_uuid(),module text,title text,amount numeric,status text,audience text default 'private',data jsonb default '{}');
create table assessment_columns(id uuid primary key default gen_random_uuid(),name text);
create table report_scores(id uuid primary key default gen_random_uuid(),column_id uuid,student_id uuid,student_id_ref text default '',student_name text default '',class text default '',subject text default '',term text default '',session text default '',score numeric default 0);
create table report_cards(id uuid primary key default gen_random_uuid(),student_id uuid,term text,session text);
alter table report_scores enable row level security;alter table report_cards enable row level security;
insert into report_scores(student_id,student_name,class,subject,score)values('${KID}','Locked Kid','JSS 1','Maths',88);
insert into report_cards(student_id,term,session)values('${KID}','Third Term','2025/2026');
create function public.is_admin(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('admin','super_admin','principal','proprietor','head_teacher','bursar')and status in('approved','active'))$$;
create function public.is_staff(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('admin','super_admin','principal','proprietor','head_teacher','bursar','staff','teacher')and status in('approved','active'))$$;
create function public.is_parent_of(uid uuid,child uuid)returns boolean language sql security definer stable as $$select exists(select 1 from parent_child where parent_id=uid and student_id=child)$$;
grant usage on schema public to authenticated;grant all on all tables in schema public to authenticated;
-- the original family-read policies the pack replaces
create policy "v7_report_scores_read" on public.report_scores for select using (true);
create policy "v7_report_cards_family" on public.report_cards for select using (true);`);

const strip=t=>t.split('\n').filter(l=>!/^\s*notify pgrst/.test(l)&&!/pg_notify/.test(l)).join('\n');
await db.exec(strip(fs.readFileSync(new URL('../database/v10.7-fee-locks-arrears.sql',import.meta.url),'utf8')));

const as=async uid=>db.exec(`update auth_uid_holder set id='${uid}'`);

/* 1. Bulk lock as admin; refusal as non-admin */
await as(STUD_U);
let r=(await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'portal',true,'x') d`)).rows[0].d;
if(r.ok)throw Error('non-admin lock must be refused');
await as(ADMIN);
r=(await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'portal',true,'Pay your fees at the bursary.') d`)).rows[0].d;
if(!r.ok||r.updated!==1)throw Error('admin portal lock failed: '+JSON.stringify(r));

/* 2. Access state: student + parent locked, staff not */
await as(STUD_U);
let g=(await db.query(`select public.sc_my_access_state() d`)).rows[0].d;
if(!g.portal_locked||!/bursary/.test(g.portal_lock_message))throw Error('student not locked: '+JSON.stringify(g));
await as(PARENT);
g=(await db.query(`select public.sc_my_access_state() d`)).rows[0].d;
if(!g.portal_locked)throw Error('parent of locked child must be locked');
await as(ADMIN);
g=(await db.query(`select public.sc_my_access_state() d`)).rows[0].d;
if(g.portal_locked)throw Error('staff must never be locked');

/* 3. RLS: report data hidden for locked family, visible again after unlock */
await db.exec(`set role authenticated`);
await as(STUD_U);
let rows=(await db.query(`select count(*)::int n from report_scores`)).rows[0].n;
if(rows!==0)throw Error('portal-locked student can still read report_scores');
let cards=(await db.query(`select count(*)::int n from report_cards`)).rows[0].n;
if(cards!==0)throw Error('portal-locked student can still read report_cards');
await db.exec(`reset role`);
await as(ADMIN);
await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'portal',false,'') d`);
// report-only lock now
r=(await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'report',true,'Report withheld — fees.') d`)).rows[0].d;
if(!r.ok)throw Error('report lock failed');
await db.exec(`set role authenticated`);
await as(PARENT);
rows=(await db.query(`select count(*)::int n from report_scores`)).rows[0].n;
if(rows!==0)throw Error('report-locked parent can still read scores');
await db.exec(`reset role`);
await as(ADMIN);
await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'report',false,'')`);
await db.exec(`set role authenticated`);
await as(STUD_U);
rows=(await db.query(`select count(*)::int n from report_scores`)).rows[0].n;
if(rows!==1)throw Error('unlock did not restore report access');
g=(await db.query(`select public.sc_my_access_state() d`)).rows[0].d;
if(g.portal_locked||(g.students||[]).some(k=>k.report_locked))throw Error('locks should be clear now');
await db.exec(`reset role`);

/* 4. Opening arrears in fee state */
await as(ADMIN);
let f=(await db.query(`select public.sc_student_fee_state('${KID}') d`)).rows[0].d;
if(Number(f.total_due)!==100000||Number(f.arrears)!==0)throw Error('baseline fee state wrong: '+JSON.stringify({due:f.total_due,arr:f.arrears}));
await db.query(`update students set opening_arrears=35000,opening_arrears_note='2nd Term 2025/2026 balance' where id='${KID}'`);
f=(await db.query(`select public.sc_student_fee_state('${KID}') d`)).rows[0].d;
if(Number(f.arrears)!==35000||Number(f.total_due)!==135000||Number(f.opening_arrears)!==35000)throw Error('opening arrears not applied: '+JSON.stringify({arr:f.arrears,due:f.total_due}));
const oaRow=(f.arrears_rows||[]).find(x=>x.opening);
if(!oaRow||!/2nd Term/.test(oaRow.session))throw Error('labelled opening row missing: '+JSON.stringify(f.arrears_rows));
// clearing
await db.query(`update students set opening_arrears=0 where id='${KID}'`);
f=(await db.query(`select public.sc_student_fee_state('${KID}') d`)).rows[0].d;
if(Number(f.arrears)!==0||Number(f.total_due)!==100000)throw Error('clearing opening arrears failed');
// override still wins
await db.query(`update students set opening_arrears=35000 where id='${KID}'`);
await db.query(`insert into fee_payments(student_id,amount_paid,fee_total,term,session,total_overridden)values('${KID}',20000,90000,'Third Term','2025/2026',true)`);
f=(await db.query(`select public.sc_student_fee_state('${KID}') d`)).rows[0].d;
if(!f.override||Number(f.bill)!==90000||Number(f.arrears)!==0||Number(f.total_due)!==70000)throw Error('override precedence broken: '+JSON.stringify({bill:f.bill,arr:f.arrears,due:f.total_due}));

/* 5. Community trigger */
await db.query(`insert into module_records(module,title)values('lost_found','Blue lunch box')`);
const aud=(await db.query(`select audience from module_records where title='Blue lunch box'`)).rows[0].audience;
if(aud!=='all')throw Error('community trigger failed: '+aud);

console.log(JSON.stringify({ok:true,
 locks:{admin_bulk:true,non_admin_refused:true,parent_inherits:true,staff_exempt:true},
 rls:{portal_hides_reports:true,report_only_hides:true,unlock_restores:true},
 opening_arrears:{applied:135000,labelled_row:true,clearable:true,override_precedence:true},
 community_trigger:'all'},null,2));
await db.close();
