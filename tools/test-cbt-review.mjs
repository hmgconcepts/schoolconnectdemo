#!/usr/bin/env node
/* V10.6 regression — teacher review of manual-marked CBT questions.
   Proves:
     1. A paper with essay questions submits as manual_review with
        ungraded_count>0 and manual questions COUNTED in the total.
     2. cbt_review_result awards marks (capped at the question's mark),
        re-totals atomically, flips to 'graded' when everything is marked.
     3. Partial review (one of two essays) keeps status 'manual_review'.
     4. Awards are auditable/undoable (null removes an award) and a bulk
        regrade PRESERVES saved awards (award-aware engine).
     5. Non-staff callers are refused. */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const T='11111111-1111-4111-8111-111111111111', EXAM='33333333-3333-4333-8333-333333333333';

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth_uid_holder(id uuid);insert into auth_uid_holder values('${T}');
create function auth.uid()returns uuid language sql stable as $$select id from auth_uid_holder limit 1$$;
create table profiles(id uuid primary key,full_name text,role text,status text);
insert into profiles values('${T}','Marker','teacher','approved');
create table students(id uuid primary key,admission_no text,full_name text,class text,arm text,status text);
create table subjects(id uuid primary key default gen_random_uuid(),name text,teacher_id uuid,teacher text);
insert into subjects(name,teacher)values('English','Marker');
create table classes(id uuid primary key default gen_random_uuid(),name text,class_teacher text);
create table staff(id uuid primary key default gen_random_uuid(),user_id uuid,full_name text,status text,subjects text[]);
create table school_settings(id int primary key,school_name text,short_name text,motto text,address text,phone text,email text,logo_url text);insert into school_settings values(1,'S','S','','','','','');
create table cbt_exams(id uuid primary key,code text,title text,subject text default 'General',class text,term text,session text,assessment_type text default 'exam',duration int default 45,duration_min int default 45,max_score numeric default 100,exam_mode text default 'open',is_open boolean default true,is_archived boolean default false,start_at timestamptz,close_at timestamptz,attempt_limit int default 3,randomise boolean default false,select_count int default 0,negative_mark numeric default 0,pass_mark numeric default 50,release_results boolean default true,certificate_enabled boolean default false,report_column text,instructions text default '',anti_cheat_config jsonb default '{}',csv_data jsonb default '[]',questions jsonb default '[]',teacher_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table cbt_results(id uuid primary key default gen_random_uuid(),exam_id uuid,student_id uuid,student_name text,student_class text,student_id_ref text,student_type text,score numeric,total numeric,percent numeric,correct_count int,wrong_count int,skipped_count int,ungraded_count int default 0,grading_status text default 'graded',engine_version text default '',attempt_number int,time_taken int,violations int,violation_log jsonb,answers_data jsonb,cert_code text,client_ref text,subject_scores jsonb default '{}',submitted_at timestamptz default now(),unique(exam_id,client_ref));
create function public.is_staff(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('teacher','staff','admin','super_admin')and status in('approved','active'))$$;
create function public.is_admin(uid uuid)returns boolean language sql stable as $$select exists(select 1 from profiles where id=uid and role in('admin','super_admin')and status in('approved','active'))$$;
create function public.sc_cbt_norm(text)returns text language sql immutable as $$select lower(regexp_replace(trim(coalesce($1,'')),'\\\\s+',' ','g'))$$;`);

// V5.1 core engine (helpers + submit), V10.3 (fraction engine + items), V10.4 (subject gate), then V10.6.
const strip = (t) => t.split('\n').filter(l => !/^\s*notify pgrst/.test(l) && !/pg_notify/.test(l)).join('\n');
await db.exec(strip(fs.readFileSync(new URL('../database/cbt-v5.1-zero-score-hotfix.sql', import.meta.url),'utf8')));
await db.exec(strip(fs.readFileSync(new URL('../database/v10.3-cbt-advanced-types.sql', import.meta.url),'utf8')).replace(/alter table public\.fee_payments[^;]*;/g,'').replace(/create or replace function public\.sc_student_fee_state[\s\S]*?end \$\$;/,'').replace(/revoke all on function public\.sc_student_fee_state[^;]*;/g,'').replace(/grant execute on function public\.sc_student_fee_state[^;]*;/g,''));
await db.exec(strip(fs.readFileSync(new URL('../database/v10.4-cbt-multisubject-rls.sql', import.meta.url),'utf8')).replace(/drop policy[^;]*;/g,'').replace(/create policy[\s\S]*?;/g,''));
await db.exec(strip(fs.readFileSync(new URL('../database/v10.6-cbt-review-community.sql', import.meta.url),'utf8')).replace(/update public\.module_records[\s\S]*?;/,''));

const bank=[
 {question:'2+2?',type:'mcq',options:['3','4'],answer:'B',mark:1},
 {question:'Discuss photosynthesis.',type:'essay',mark:5,explanation:'Light + chlorophyll + CO2 → glucose'},
 {question:'Write a loop.',type:'code',mark:4}
];
await db.query(`insert into cbt_exams(id,code,title,class,subject,teacher_id,csv_data,questions)values($1,'REV1','Review test','SS1','English','${T}',$2,$2)`,[EXAM,JSON.stringify(bank)]);

/* 1. Submit: mcq correct, essay + code answered (manual) */
const payload={exam_id:EXAM,student_name:'Cand',student_class:'SS1',client_ref:'rev-1',answers_data:[
 {index:0,answer:'B'},{index:1,answer:'Plants use chlorophyll and light.'},{index:2,answer:'for(i=0;i<3;i++){}'}]};
const out=(await db.query(`select public.cbt_submit_v5($1::jsonb) d`,[JSON.stringify(payload)])).rows[0].d;
if(!out.saved) throw Error('submit failed: '+JSON.stringify(out));
if(out.grading_status!=='manual_review'||out.ungraded_count!==2) throw Error('expected manual_review with 2 ungraded: '+JSON.stringify(out));
const rid=(await db.query(`select id from cbt_results where client_ref='rev-1'`)).rows[0].id;

/* 2. Partial review: essay only, award 4 of 5 */
let r=(await db.query(`select public.cbt_review_result($1,'{"1":4}'::jsonb) d`,[rid])).rows[0].d;
if(!r.ok) throw Error('review failed: '+JSON.stringify(r));
if(Number(r.total)!==10) throw Error('manual marks must count in total (1+5+4=10): '+r.total);
if(Number(r.score)!==5) throw Error('score after essay award should be 1+4=5: '+r.score);
if(r.grading_status!=='manual_review'||r.manual_left!==1) throw Error('one code question still unmarked: '+JSON.stringify(r));

/* 3. Award beyond the mark is capped; finishing flips to graded */
r=(await db.query(`select public.cbt_review_result($1,'{"2":99}'::jsonb) d`,[rid])).rows[0].d;
if(!r.ok||r.grading_status!=='graded'||r.manual_left!==0) throw Error('finish review failed: '+JSON.stringify(r));
if(Number(r.score)!==9) throw Error('award must cap at mark 4 (1+4+4=9): '+r.score);
if(r.release_results!==true) throw Error('finished review should release results');

/* 4. Undo: null removes the code award → back to manual_review; regrade preserves the essay award */
r=(await db.query(`select public.cbt_review_result($1,'{"2":null}'::jsonb) d`,[rid])).rows[0].d;
if(r.grading_status!=='manual_review'||Number(r.score)!==5) throw Error('undo failed: '+JSON.stringify(r));
const rg=(await db.query(`select public.cbt_regrade_exam_results_v5($1) d`,[EXAM])).rows[0].d;
if(!rg.ok||rg.regraded_count!==1) throw Error('bulk regrade failed: '+JSON.stringify(rg));
const kept=(await db.query(`select score,total,ungraded_count,grading_status,manual_awards from cbt_results where id=$1`,[rid])).rows[0];
if(Number(kept.score)!==5||Number(kept.total)!==10||kept.ungraded_count!==1) throw Error('regrade must preserve awards: '+JSON.stringify(kept));

/* 5. Non-staff refused */
await db.exec(`update profiles set role='student' where id='${T}'`);
r=(await db.query(`select public.cbt_review_result($1,'{"2":4}'::jsonb) d`,[rid])).rows[0].d;
if(r.ok) throw Error('non-staff must be refused');

console.log(JSON.stringify({ok:true,
 submit:{status:out.grading_status,ungraded:out.ungraded_count},
 partial_review:{score:5,total:10,left:1},
 finish:{capped_award:4,final_score:9,released:true},
 undo_and_regrade:{score_after_undo:5,awards_preserved:true},
 non_staff_refused:true},null,2));
await db.close();
