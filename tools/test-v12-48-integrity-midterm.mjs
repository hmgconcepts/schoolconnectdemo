#!/usr/bin/env node
// V12.48/49 regression: canonical bank save+verification, append, midterm/terminal separation,
// report score auto-sync, and parent visibility only after publish.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const schema=fs.readFileSync(new URL('../database/complete-schema.sql',import.meta.url),'utf8')
  .replace(/create extension if not exists "uuid-ossp";/ig,'')
  .replace(/create extension if not exists "pgcrypto";/ig,'');
const admin='55555555-5555-4555-8555-555555555555';
const parent='66666666-6666-4666-8666-666666666666';
const exam='77777777-7777-4777-8777-777777777777';
const q=(sql,args=[])=>db.query(sql,args);
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}'::jsonb,email_confirmed_at timestamptz,updated_at timestamptz default now(),created_at timestamptz default now());create table auth_uid_holder(uid uuid);insert into auth_uid_holder values(null);create function auth.uid()returns uuid language sql stable as $$select uid from auth_uid_holder limit 1$$;create function auth.role()returns text language sql stable as $$select case when (select uid from auth_uid_holder limit 1) is null then 'anon' else 'authenticated' end::text$$;create function auth.jwt()returns jsonb language sql stable as $$select '{}'::jsonb$$;`);
await db.exec(schema);
// Reproduce the production-only legacy enum CHECK that rejected V12.55's new value.
await q(`alter table cbt_exams add constraint cbt_exams_assessment_type_check check (assessment_type in('exam','ca','test','assignment','project','quiz','practical'))`);
await q(`insert into cbt_exams(code,title,subject,class,term,session,assessment_type,is_open) values('LEGACYCA','Legacy CA','Mathematics','JSS 1','First Term','2026/2027','ca',true),('LEGACYTEST','Legacy Midterm Test','Mathematics','JSS 1','First Term','2026/2027','test',true)`);
await db.exec(schema); // cumulative idempotence + check-constraint repair + V12.55 normalization
const legacyTypes=(await q(`select array_agg(assessment_type order by code) values from cbt_exams where code in('LEGACYCA','LEGACYTEST')`)).rows[0].values;
const oldCheck=(await q(`select count(*)::int n from pg_constraint where conname='cbt_exams_assessment_type_check' and conrelid='cbt_exams'::regclass`)).rows[0].n;
if(!legacyTypes||legacyTypes.some(x=>x!=='midterm')||oldCheck!==0)throw new Error('legacy purpose normalization/check-constraint repair failed '+JSON.stringify({legacyTypes,oldCheck}));
const aliases=(await q(`select public.sc_is_midterm_column('Mid term column','') as spaced_label,public.sc_is_midterm_column('CA 2','') as ca2_label,public.sc_is_midterm_column('Test','Mid-term Test') as legacy_type`)).rows[0];
if(!aliases.spaced_label||!aliases.ca2_label||!aliases.legacy_type)throw new Error('Midterm punctuation/legacy column aliases were not recognized '+JSON.stringify(aliases));
await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'admin@test',now()),($2,'parent@test',now())`,[admin,parent]);
await q(`insert into profiles(id,email,full_name,role,status) values($1,'admin@test','Test Admin','admin','active'),($2,'parent@test','Test Parent','parent','active') on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,role=excluded.role,status=excluded.status`,[admin,parent]);
const sid=(await q(`insert into students(admission_no,full_name,class,status) values('ADM001','Student One','JSS 1','active') returning id`)).rows[0].id;
await q(`insert into parent_child(parent_id,student_id) values($1,$2)`,[parent,sid]);
const sid2=(await q(`insert into students(admission_no,full_name,class,status) values('ADM002','Student Two','JSS 1','active') returning id`)).rows[0].id;
await q(`insert into cbt_exams(id,code,title,subject,class,term,session,is_open,exam_mode,csv_data,questions) values($1,'TST123','Test CBT','Mathematics','JSS 1','First Term','2026/2027',true,'registered',$2::jsonb,$2::jsonb)`,[exam,JSON.stringify([{question:'Old',type:'mcq',options:['A','B'],answer:'A',mark:1}])]);
await q(`update auth_uid_holder set uid=$1`,[admin]);
const bank=[{question:'Edited question',type:'mcq',options:['A','B'],answer:'B',mark:2}];
const save=(await q(`select cbt_force_replace_bank_v3($1,$2::jsonb,1) as d`,[exam,JSON.stringify(bank)])).rows[0].d;
if(!save.ok||save.version!==2) throw new Error('force replace failed '+JSON.stringify(save));
const verified=(await q(`select cbt_verify_exam_bank($1,$2) as d`,[exam,save.hash])).rows[0].d;
if(!verified.ok||verified.verified!==true||verified.aliases_match!==true||Number(verified.count)!==1||Number(verified.questions_count)!==1) throw new Error('canonical dual-alias verify failed '+JSON.stringify(verified));
await q(`update cbt_exams set questions='[{"question":"stale secondary alias"}]'::jsonb where id=$1`,[exam]);
const aliasRepair=(await q(`select cbt_force_replace_bank_v3($1,$2::jsonb,2) as d`,[exam,JSON.stringify(bank)])).rows[0].d;
const repairedVerify=(await q(`select cbt_verify_exam_bank($1,$2) as d`,[exam,aliasRepair.hash])).rows[0].d;
if(!aliasRepair.ok||aliasRepair.aliases_repaired!==true||aliasRepair.version!==3||repairedVerify.aliases_match!==true||repairedVerify.verified!==true)throw new Error('replace must repair stale csv_data/questions aliases even when primary bank is unchanged '+JSON.stringify({aliasRepair,repairedVerify}));
const appended=(await q(`select cbt_force_append_bank_v2($1,$2::jsonb) as d`,[exam,JSON.stringify([{question:'Attached CSV question',type:'numeric',answer:'7',mark:1}])])).rows[0].d;
const v2=(await q(`select cbt_verify_exam_bank($1,$2) as d`,[exam,appended.hash])).rows[0].d;
if(!appended.ok||Number(appended.total)!==2||v2.verified!==true||v2.aliases_match!==true) throw new Error('append/verify failed '+JSON.stringify({appended,v2}));
const legacyBankExam='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await q(`insert into cbt_exams(id,code,title,subject,class,term,session,csv_data,questions) values($1,'LEGQ57','Legacy questions-only bank','Mathematics','JSS 1','First Term','2026/2027','[]'::jsonb,$2::jsonb)`,[legacyBankExam,JSON.stringify([{question:'Existing legacy question',type:'mcq',options:['A','B'],answer:'A',mark:1}])]);
const legacyAppend=(await q(`select cbt_force_append_bank_v2($1,$2::jsonb) as d`,[legacyBankExam,JSON.stringify([{question:'New attached row',type:'mcq',options:['C','D'],answer:'D',mark:1}])])).rows[0].d;
const legacyAppendVerify=(await q(`select cbt_verify_exam_bank($1,$2) as d`,[legacyBankExam,legacyAppend.hash])).rows[0].d;
if(!legacyAppend.ok||Number(legacyAppend.total)!==2||!legacyAppendVerify.verified||!legacyAppendVerify.aliases_match)throw new Error('Attach CSV must preserve a legacy questions-only bank and synchronize both aliases '+JSON.stringify({legacyAppend,legacyAppendVerify}));
const cols=(await q(`insert into assessment_columns(class,subject,term,session,name,max_mark,cbt_assessment_type) values
('JSS 1','Mathematics','First Term','2026/2027','Midterm',30,'test'),
('JSS 1','Mathematics','First Term','2026/2027','CA1',10,'ca'),
('JSS 1','Mathematics','First Term','2026/2027','CA 2',10,'Mid-term Test') returning id,name`)).rows;
const score=(col,mark)=>q(`insert into report_scores(column_id,student_id,student_id_ref,student_name,class,subject,term,session,score,source) values($1,$2,'ADM001','Student One','JSS 1','Mathematics','First Term','2026/2027',$3,'cbt')`,[col,sid,mark]);
await score(cols[0].id,24);await score(cols[1].id,5);await score(cols[2].id,6);
const mid=(await q(`select * from midterm_report_cards where student_id_ref='ADM001' and class='JSS 1' and term='First Term' and session='2026/2027'`)).rows[0];
if(!mid||Number(mid.total)!==35||Number(mid.max_total)!==50||Number(mid.average)!==70||Object.keys(mid.scores||{}).length!==3||(mid.score_details||[]).length!==3||mid.published!==false) throw new Error('midterm legacy CA1/CA2 detail or multi-column preservation failed '+JSON.stringify(mid));
const gen=(await q(`select generate_midterm_reports('JSS 1','First Term','2026/2027') as d`)).rows[0].d;
if(!gen.ok||Number(gen.eligible_columns)!==3||Number(gen.with_scores)!==1||Number(gen.without_scores)!==1)throw new Error('midterm generation did not accept legacy CA/Test destinations '+JSON.stringify(gen));
const noScore=(await q(`select has_scores,total from midterm_report_cards where student_id_ref='ADM002' and class='JSS 1' and term='First Term' and session='2026/2027'`)).rows[0];
if(!gen.ok||!noScore||noScore.has_scores!==false||Number(noScore.total)!==0)throw new Error('midterm roster completeness failed '+JSON.stringify({gen,noScore}));
const sid3=(await q(`insert into students(admission_no,full_name,class,status) values('ADM003','Student Three','JSS 2','active') returning id`)).rows[0].id;
const noColumnGen=(await q(`select generate_midterm_reports('JSS 2','First Term','2026/2027') as d`)).rows[0].d;
const noColumnRow=(await q(`select has_scores from midterm_report_cards where student_id_ref='ADM003' and class='JSS 2' and term='First Term' and session='2026/2027'`)).rows[0];
if(!noColumnGen.ok||Number(noColumnGen.generated)!==1||!noColumnGen.warning||!noColumnRow||noColumnRow.has_scores!==false)throw new Error('no-column generation should create explicit no-score roster report '+JSON.stringify({noColumnGen,noColumnRow}));
const pushExam='88888888-8888-4888-8888-888888888888';
await q(`insert into cbt_exams(id,code,title,subject,class,term,session,assessment_type,report_column,max_score,is_open,exam_mode) values($1,'BULK57','Bulk Midterm','Mathematics','JSS 1','First Term','2026/2027','midterm','Midterm',20,true,'registered')`,[pushExam]);
await q(`insert into cbt_results(exam_id,client_ref,student_id,student_name,student_class,student_id_ref,student_type,score,total,percent,attempt_number,subject_scores,engine_version,grading_status,created_at) values
($1,'bulk-attempt-1',$2,'Student One','JSS 1','ADM001','registered',8,20,40,1,'{}','v5.1.0','graded',now()-interval '1 minute'),
($1,'bulk-attempt-2',$2,'Student One','JSS 1','ADM001','registered',18,20,90,2,'{}','v5.1.0','graded',now())`,[pushExam,sid]);
await q(`set role authenticated`);
const previewCounts=(await q(`select sc_cbt_bulk_result_counts_v1(array[$1]::uuid[]) as d`,[pushExam])).rows[0].d;
const pushed=(await q(`select sc_cbt_bulk_push_exam_v2($1,null,true,20,true,'best',null,true) as d`,[pushExam])).rows[0].d;
await q(`reset role`);
const pushedRows=(await q(`select count(*)::int n,max(score) score from report_scores where source like 'cbt:%' and student_id_ref='ADM001' and class='JSS 1' and subject='Mathematics' and term='First Term' and session='2026/2027' and column_id=(select id from assessment_columns where class='JSS 1' and subject='*' and term='First Term' and session='2026/2027' and name='Midterm')`)).rows[0];
const pushedMid=(await q(`select score_details from midterm_report_cards where student_id_ref='ADM001' and class='JSS 1' and term='First Term' and session='2026/2027'`)).rows[0];
if(!previewCounts.ok||Number(previewCounts.counts?.[0]?.count)!==2||!pushed.ok||Number(pushed.saved)!==1||!pushed.created_column||Number(pushedRows.n)!==1||Number(pushedRows.score)!==18||(pushedMid.score_details||[]).length!==3)throw new Error('server-side RLS-safe CBT push must count attempts, create a column, collapse duplicates and update Midterm report '+JSON.stringify({previewCounts,pushed,pushedRows,pushedMid}));
const pushExam2='99999999-9999-4999-8999-999999999999';
await q(`insert into cbt_exams(id,code,title,subject,class,term,session,assessment_type,report_column,max_score,is_open,exam_mode) values($1,'BULK58','Second Bulk Midterm','Mathematics','JSS 1','First Term','2026/2027','midterm','Midterm',20,true,'registered')`,[pushExam2]);
await q(`insert into cbt_results(exam_id,client_ref,student_id,student_name,student_class,student_id_ref,student_type,score,total,percent,attempt_number,subject_scores,engine_version,grading_status) values
($1,'bulk-other-1',$2,'Student One','JSS 1','ADM001','registered',16,20,80,1,'{}','v5.1.0','graded'),
($1,'bulk-other-2',$3,'Student Two','JSS 1','ADM002','registered',10,20,50,1,'{}','v5.1.0','graded')`,[pushExam2,sid,sid2]);
await q(`set role authenticated`);
const batch=(await q(`select sc_cbt_bulk_push_batch_v1(array[$1,$2]::uuid[],null,true,20,true,'best',null,true) as d`,[pushExam,pushExam2])).rows[0].d;
await q(`reset role`);
const batchRows=(await q(`select student_id_ref,score from report_scores where column_id=(select id from assessment_columns where class='JSS 1' and subject='*' and term='First Term' and session='2026/2027' and name='Midterm') and subject='Mathematics' and term='First Term' and session='2026/2027' order by student_id_ref`)).rows;
if(!batch.ok||Number(batch.exam_count)!==2||Number(batch.saved)!==2||batchRows.length!==2||Number(batchRows.find(x=>x.student_id_ref==='ADM001')?.score)!==18||Number(batchRows.find(x=>x.student_id_ref==='ADM002')?.score)!==10)throw new Error('overlapping exam batch should merge by student/subject/destination and choose best attempt '+JSON.stringify({batch,batchRows}));
const scoredNoScore=(await q(`select has_scores,total from midterm_report_cards where student_id_ref='ADM002' and class='JSS 1' and term='First Term' and session='2026/2027'`)).rows[0];if(!scoredNoScore||scoredNoScore.has_scores!==true||Number(scoredNoScore.total)!==10)throw new Error('bulk score push failed to update previously no-score Midterm row '+JSON.stringify(scoredNoScore));
const terminalCount=Number((await q(`select count(*)::int n from report_cards where student_id_ref='ADM001'`)).rows[0].n);
if(terminalCount!==0) throw new Error('midterm generation changed terminal report_cards');
await q(`update auth_uid_holder set uid=$1`,[parent]);
const hidden=(await q(`select get_midterm_report('ADM001','JSS 1','First Term','2026/2027') as d`)).rows[0].d;
if(hidden.ok!==false||hidden.error!=='not_published') throw new Error('unpublished report leaked to parent '+JSON.stringify(hidden));
await q(`update auth_uid_holder set uid=$1`,[admin]);
await q(`select publish_midterm_reports('JSS 1','First Term','2026/2027',true)`);
await q(`update auth_uid_holder set uid=$1`,[parent]);
const visible=(await q(`select get_midterm_report('ADM001','JSS 1','First Term','2026/2027') as d`)).rows[0].d;
if(!visible.ok||visible.report.student_id_ref!=='ADM001') throw new Error('published parent report unavailable '+JSON.stringify(visible));
console.log(JSON.stringify({ok:true,canonical_replace_verified:true,append_verified:true,secondary_bank_alias_repaired:true,legacy_questions_only_csv_append_preserved:true,legacy_assessment_type_normalized:true,assessment_type_check_constraint_removed_safely:true,midterm_legacy_CA1_CA2_aliases:true,midterm_multi_column_scores_preserved:true,midterm_no_column_roster_generated:true,standalone_score_max_sheet_data:true,rls_safe_bulk_push:true,bulk_preview_count_rpc:true,bulk_attempts_deduplicated:true,overlapping_exam_batch_merged:true,terminal_separate:true,parent_unpublished_blocked:true,parent_published_allowed:true},null,2));
await db.close();
