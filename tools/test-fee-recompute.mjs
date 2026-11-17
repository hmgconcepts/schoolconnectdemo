#!/usr/bin/env node
/* V10.8 regression — self-healing fee ledger + widened report-lock RLS.
   Proves the user's exact scenarios:
     1. WRONG AMOUNT: bursar records 15,000 where the student paid 10,000 →
        EDITING the row auto-recomputes every later snapshot (fee_total /
        balance) for the term.
     2. PHANTOM PAYMENT: bursar records 50,000 for a student who paid nothing
        → DELETING the row restores the ledger exactly.
     3. The bursar override row stays authoritative through recomputes.
     4. Autoheal trigger fires on INSERT / UPDATE / DELETE without any client
        call (statement-level, recursion-guarded).
     5. Report lock now blanks RESULTS and CBT_RESULTS for the locked family
        too (issue-1 widening), and unlock restores. */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const ADMIN='11111111-1111-4111-8111-111111111111';
const STUD_U='33333333-3333-4333-8333-333333333333';
const KID='44444444-4444-4444-8444-444444444444';

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth_uid_holder(id uuid);insert into auth_uid_holder values('${ADMIN}');
create function auth.uid()returns uuid language sql stable as $$select id from auth_uid_holder limit 1$$;
create function auth.jwt()returns jsonb language sql stable as $$select '{}'::jsonb$$;
create table profiles(id uuid primary key,full_name text,role text,status text);
insert into profiles values('${ADMIN}','Admin','admin','approved'),('${STUD_U}','Student','student','approved');
create table parent_child(id uuid primary key default gen_random_uuid(),parent_id uuid,student_id uuid);
create table students(id uuid primary key,user_id uuid,guardian_email text,full_name text,class text,arm text,department text,admission_no text,status text default 'active',portal_locked boolean default false,portal_lock_message text default '',report_locked boolean default false,report_lock_message text default '',locked_by uuid,locked_at timestamptz,opening_arrears numeric default 0,opening_arrears_note text default '');
insert into students(id,user_id,full_name,class)values('${KID}','${STUD_U}','Ledger Kid','JSS 1');
create table academic_periods(id int primary key,term text,session text,is_current boolean);insert into academic_periods values(1,'Third Term','2025/2026',true);
create table class_fee_structure(id uuid primary key default gen_random_uuid(),class text,arm text default '',department text default '',term text default 'Current Term',session text default '',tuition numeric default 0,exam_fee numeric default 0,development numeric default 0,transport numeric default 0,boarding numeric default 0,other_fee numeric default 0,discount numeric default 0,total numeric default 0,currency text default '₦',due_date date,note text default '',active boolean default true,updated_at timestamptz default now());
create table fee_payments(id uuid primary key default gen_random_uuid(),student_id uuid,student_name text,amount_paid numeric,fee_total numeric,balance numeric,term text default 'Third Term',session text default '2025/2026',total_overridden boolean default false,created_at timestamptz default now());
create table module_records(id uuid primary key default gen_random_uuid(),module text,title text,amount numeric,status text,audience text default 'private',data jsonb default '{}');
create table subjects(id uuid primary key default gen_random_uuid(),name text,teacher_id uuid,teacher text);
create table classes(id uuid primary key default gen_random_uuid(),name text,class_teacher text);
create table staff(id uuid primary key default gen_random_uuid(),user_id uuid,full_name text,status text,subjects text[]);
create table results(id uuid primary key default gen_random_uuid(),student_id uuid,subject text,class text,score numeric,teacher_id uuid);
create table cbt_exams(id uuid primary key default gen_random_uuid(),code text,subject text,class text,teacher_id uuid);
create table cbt_results(id uuid primary key default gen_random_uuid(),exam_id uuid,student_id uuid,student_name text,score numeric);
alter table results enable row level security;alter table cbt_results enable row level security;
insert into results(student_id,subject,class,score)values('${KID}','Maths','JSS 1',77);
insert into cbt_results(student_id,student_name,score)values('${KID}','Ledger Kid',64);
create function public.is_admin(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('admin','super_admin','principal','proprietor','head_teacher','bursar')and status in('approved','active'))$$;
create function public.is_staff(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('admin','super_admin','principal','proprietor','head_teacher','bursar','staff','teacher')and status in('approved','active'))$$;
create function public.is_parent_of(uid uuid,child uuid)returns boolean language sql security definer stable as $$select exists(select 1 from parent_child where parent_id=uid and student_id=child)$$;
create function public.teacher_can_manage_subject_class(p_uid uuid,p_subject text default '',p_class text default '')returns boolean language sql stable as $$select false$$;
grant usage on schema public to authenticated;grant all on all tables in schema public to authenticated;
create table report_scores(id uuid primary key default gen_random_uuid(),student_id uuid,student_id_ref text default '');
create table report_cards(id uuid primary key default gen_random_uuid(),student_id uuid);
create policy "v7_report_scores_read" on public.report_scores for select using(true);
create policy "v7_report_cards_family" on public.report_cards for select using(true);
create policy results_scope_select on public.results for select using(true);
create policy cbt_result_scope_select on public.cbt_results for select using(true);`);

const strip=t=>t.split('\n').filter(l=>!/^\s*notify pgrst/.test(l)&&!/pg_notify/.test(l)).join('\n');
await db.exec(strip(fs.readFileSync(new URL('../database/v10.7-fee-locks-arrears.sql',import.meta.url),'utf8'))
  .replace(/alter table public\.students add column[^;]*;/g,''));
await db.exec(strip(fs.readFileSync(new URL('../database/v10.8-fee-recompute.sql',import.meta.url),'utf8')));

const as=async uid=>db.exec(`update auth_uid_holder set id='${uid}'`);
const rows=async()=>(await db.query(`select amount_paid,fee_total,balance from fee_payments where student_id='${KID}' order by created_at,id`)).rows.map(r=>({amt:+r.amount_paid,ft:+r.fee_total,bal:+r.balance}));

/* Ledger: bill 100k. P1 = 40k (ft 100k, bal 60k). P2 = wrong 15k (should be 10k). P3 = 20k. */
await as(ADMIN);
await db.query(`insert into fee_payments(student_id,student_name,amount_paid,fee_total)values('${KID}','Ledger Kid',40000,100000)`);
await new Promise(r=>setTimeout(r,5));
await db.query(`insert into fee_payments(student_id,student_name,amount_paid)values('${KID}','Ledger Kid',15000)`);
await new Promise(r=>setTimeout(r,5));
await db.query(`insert into fee_payments(student_id,student_name,amount_paid)values('${KID}','Ledger Kid',20000)`);
let R=await rows();
/* autoheal on INSERT should have snapshotted: 100k → P1(ft100k,bal60k) P2(ft60k,bal45k) P3(ft45k,bal25k) */
if(R[0].ft!==100000||R[0].bal!==60000||R[1].ft!==60000||R[1].bal!==45000||R[2].ft!==45000||R[2].bal!==25000)
  throw Error('insert autoheal wrong: '+JSON.stringify(R));

/* 1. WRONG AMOUNT: edit P2 from 15k → 10k. Later snapshots must shift. */
const p2=(await db.query(`select id from fee_payments where amount_paid=15000`)).rows[0].id;
await db.query(`update fee_payments set amount_paid=10000 where id=$1`,[p2]);
R=await rows();
if(R[1].amt!==10000||R[1].ft!==60000||R[1].bal!==50000||R[2].ft!==50000||R[2].bal!==30000)
  throw Error('edit recompute wrong: '+JSON.stringify(R));

/* 2. PHANTOM PAYMENT: insert a 50k row that never happened, then DELETE it. */
await new Promise(r=>setTimeout(r,5));
await db.query(`insert into fee_payments(student_id,student_name,amount_paid)values('${KID}','Ledger Kid',50000)`);
R=await rows();
if(R[3].ft!==30000||R[3].bal!==0)throw Error('phantom insert snapshot wrong: '+JSON.stringify(R));
const ph=(await db.query(`select id from fee_payments where amount_paid=50000`)).rows[0].id;
await db.query(`delete from fee_payments where id=$1`,[ph]);
R=await rows();
if(R.length!==3||R[2].ft!==50000||R[2].bal!==30000||R[0].ft!==100000)
  throw Error('delete recompute wrong: '+JSON.stringify(R));

/* 3. Override precedence: bursar sets a personal total mid-stream. */
await new Promise(r=>setTimeout(r,5));
await db.query(`insert into fee_payments(student_id,student_name,amount_paid,fee_total,total_overridden)values('${KID}','Ledger Kid',10000,20000,true)`);
R=await rows();
/* grand = override ft 20000 + paid_before 70000 = 90000 → P1 ft90k/bal50k, P2 ft50k/bal40k, P3 ft40k/bal20k, P4 ft20k/bal10k */
if(R[0].ft!==90000||R[3].ft!==20000||R[3].bal!==10000)throw Error('override grand wrong: '+JSON.stringify(R));
const st=(await db.query(`select public.sc_recompute_fee_rows('${KID}','Third Term','2025/2026') d`)).rows[0].d;
if(!st.ok||+st.grand_total!==90000||+st.outstanding!==10000)throw Error('rpc summary wrong: '+JSON.stringify(st));

/* 5. Widened report lock: results + cbt_results blank for locked student */
await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'report',true,'Fees outstanding.')`);
await db.exec(`set role authenticated`);
await as(STUD_U);
let n=(await db.query(`select count(*)::int n from results`)).rows[0].n;
if(n!==0)throw Error('report-locked student can still read results');
n=(await db.query(`select count(*)::int n from cbt_results`)).rows[0].n;
if(n!==0)throw Error('report-locked student can still read cbt_results');
await db.exec(`reset role`);
await as(ADMIN);
await db.query(`select public.sc_set_student_locks(array['${KID}']::uuid[],'report',false,'')`);
await db.exec(`set role authenticated`);
await as(STUD_U);
n=(await db.query(`select count(*)::int n from results`)).rows[0].n;
if(n!==1)throw Error('unlock did not restore results');
n=(await db.query(`select count(*)::int n from cbt_results`)).rows[0].n;
if(n!==1)throw Error('unlock did not restore cbt_results');
await db.exec(`reset role`);

console.log(JSON.stringify({ok:true,
 insert_autoheal:true,
 wrong_amount_edit:{p2:'15000→10000',later_rows_shifted:true},
 phantom_delete:{ledger_restored:true},
 override_precedence:{grand:90000,outstanding:10000},
 widened_report_lock:{results_blanked:true,cbt_results_blanked:true,unlock_restores:true}},null,2));
await db.close();
