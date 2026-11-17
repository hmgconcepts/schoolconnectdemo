#!/usr/bin/env node
// PGlite test for V12.8-12.11 Assignment + CBT Bridge
// Tests: columns exist, mirror trigger, RPCs, cumulative totals, drive_link auto-fill

import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadSQL(file){
  let sql = fs.readFileSync(path.join(root, file), 'utf8');
  // Strip notify/pg_notify
  sql = sql.split('\n').filter(l=>!l.trim().toLowerCase().startsWith('notify') && !l.toLowerCase().includes('pg_notify')).join('\n');
  return sql;
}

async function run(){
  const db = new PGlite();
  // Minimal schema needed for assignment tests
  // Create required tables: profiles, students, cbt_exams, assignments, assignment_scores, module_records, sc_install_state
  // We'll load complete-schema.sql but strip parts that require auth schema etc? Instead create minimal stubs

  // Create auth schema stubs
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create or replace function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
    create or replace function auth.role() returns text language sql as $$ select 'authenticated' $$;
    create table if not exists public.profiles (id uuid primary key, email text, full_name text, role text, admission_no text, staff_no text, status text default 'approved');
    create table if not exists public.students (id uuid primary key default gen_random_uuid(), admission_no text unique, full_name text not null, class text, arm text, gender text, date_of_birth date, admission_year int, photo_url text, guardian_name text, guardian_phone text, guardian_email text, address text, status text default 'active', user_id uuid);
    create table if not exists public.cbt_exams (id uuid primary key default gen_random_uuid(), teacher_id uuid, code text unique not null, title text, subject text default 'General', class text default '', term text default '', session text default '', topic text default '', assessment_type text default 'exam', report_column text default '', max_score numeric default 10, duration int default 45, duration_min int default 45, attempt_limit int default 1, select_count int default 0, randomise boolean default true, negative_mark numeric default 0, exam_mode text default 'registered', is_open boolean default true, is_archived boolean default false, is_entrance boolean default false, pass_mark int default 50, release_results boolean default true, certificate_enabled boolean default true, instructions text default '', anti_cheat_config jsonb default '{}', csv_data jsonb default '[]', questions jsonb default '[]', start_at timestamptz, close_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    create table if not exists public.assignments (id uuid primary key default gen_random_uuid(), title text, description text, class text, subject text, due_date date, posted_by uuid, drive_link text, created_at timestamptz default now());
    create table if not exists public.assignment_scores (id uuid primary key default gen_random_uuid(), assignment_id uuid, student_id uuid, student_id_ref text, student_name text, class text, subject text, term text, session text, score numeric default 0, max_score numeric default 10, recorded_by uuid, created_at timestamptz default now());
    create table if not exists public.cbt_results (id uuid primary key default gen_random_uuid(), exam_id uuid, student_name text, student_id_ref text, student_class text, score numeric, total numeric, percent numeric, correct_count int, wrong_count int, skipped_count int, ungraded_count int, grading_status text, engine_version text, cert_code text, answers_data jsonb, manual_awards jsonb, created_at timestamptz default now());
    create table if not exists public.module_records (id uuid primary key default gen_random_uuid(), module text, title text, body text, status text, data jsonb, created_by uuid, audience text default 'private', created_at timestamptz default now());
    create table if not exists public.sc_install_state (key text primary key, details jsonb, created_at timestamptz default now());
    create or replace function public.is_admin(uid uuid) returns boolean language sql as $$ select true $$;
    create or replace function public.is_staff(uid uuid) returns boolean language sql as $$ select true $$;
    create or replace function public.is_parent_of(parent uuid, student uuid) returns boolean language sql as $$ select false $$;
  `);

  // Now load V12.8 + V12.9 + V12.10 + V12.11 packs
  for(const f of ['database/v12.8-assignment-cbt-bridge.sql','database/v12.9-assignment-fixes.sql','database/v12.10-final-fixes.sql','database/v12.11-assignment-final.sql']){
    let sql = loadSQL(f);
    // Remove alter table add column if exists for cbt_exams that may conflict? Keep
    // For this minimal schema, we need to ensure assignments table already has new columns, so alter will add
    try{
      await db.exec(sql);
    }catch(e){
      console.warn(`Failed to exec ${f}:`, e.message.slice(0,200));
    }
  }

  const tests=[];
  function ok(name, cond, detail=''){
    tests.push({name, cond, detail});
    console.log((cond?'OK   ':'FAIL ')+name+(detail?' — '+detail:''));
  }

  // Test 1: columns exist
  const colCheck = await db.query(`select column_name from information_schema.columns where table_name='assignments'`);
  const assignCols = colCheck.rows.map(r=>r.column_name);
  ok('assignments has cbt_exam_id column', assignCols.includes('cbt_exam_id'));
  ok('assignments has is_cbt column', assignCols.includes('is_cbt'));
  ok('assignments has source column', assignCols.includes('source'));
  ok('assignments has drive_link column', assignCols.includes('drive_link'));

  const colCheck2 = await db.query(`select column_name from information_schema.columns where table_name='assignment_scores'`);
  const scoreCols = colCheck2.rows.map(r=>r.column_name);
  ok('assignment_scores has cbt_exam_id column', scoreCols.includes('cbt_exam_id'));

  // Test 2: mirror trigger creates assignment when CBT assignment created
  await db.exec(`insert into public.cbt_exams (id, code, title, subject, class, term, session, assessment_type, max_score) values ('d6000000-0000-4000-8000-000000000001','TEST01','Homework 1: Algebra','Mathematics','JSS1','First Term','2024/2025','assignment',10)`);
  const mirror = await db.query(`select * from public.assignments where cbt_exam_id='d6000000-0000-4000-8000-000000000001'`);
  ok('mirror trigger creates assignment for CBT assignment', mirror.rows.length===1, `found ${mirror.rows.length}`);
  if(mirror.rows.length){
    ok('mirror has is_cbt true', mirror.rows[0].is_cbt===true);
    ok('mirror has drive_link auto-filled with code', (mirror.rows[0].drive_link||'').includes('TEST01'), mirror.rows[0].drive_link);
    ok('mirror has source cbt_assignment', mirror.rows[0].source==='cbt_assignment');
  }

  // Test 3: editing assessment_type from assignment to exam should delete mirror
  await db.exec(`update public.cbt_exams set assessment_type='exam' where id='d6000000-0000-4000-8000-000000000001'`);
  const afterEdit = await db.query(`select * from public.assignments where cbt_exam_id='d6000000-0000-4000-8000-000000000001'`);
  ok('changing type from assignment to exam deletes mirror', afterEdit.rows.length===0);

  // Re-create as assignment for further tests
  await db.exec(`update public.cbt_exams set assessment_type='assignment' where id='d6000000-0000-4000-8000-000000000001'`);
  const afterRe = await db.query(`select * from public.assignments where cbt_exam_id='d6000000-0000-4000-8000-000000000001'`);
  ok('changing type back to assignment re-creates mirror', afterRe.rows.length===1);

  // Test 4: multiple CBT assignments per term
  await db.exec(`insert into public.cbt_exams (id, code, title, subject, class, term, session, assessment_type, max_score) values ('d6000000-0000-4000-8000-000000000002','TEST02','Homework 2: Geometry','Mathematics','JSS1','First Term','2024/2025','assignment',10), ('d6000000-0000-4000-8000-000000000003','TEST03','Homework 3: Statistics','Mathematics','JSS1','First Term','2024/2025','assignment',10)`);
  const mirrors = await db.query(`select * from public.assignments where class='JSS1' and subject='Mathematics' and is_cbt=true`);
  ok('multiple CBT assignments per term create separate mirrors', mirrors.rows.length>=3, `found ${mirrors.rows.length}`);

  // Test 5: students and cbt_results sync
  await db.exec(`insert into public.students (id, full_name, admission_no, class) values ('11111111-0000-4000-8000-000000000001','John Doe','JSS1/001','JSS1'), ('11111111-0000-4000-8000-000000000002','Jane Smith','JSS1/002','JSS1')`);
  await db.exec(`insert into public.cbt_results (exam_id, student_name, student_id_ref, score, total, percent) values ('d6000000-0000-4000-8000-000000000001','John Doe','JSS1/001',8,10,80), ('d6000000-0000-4000-8000-000000000001','Jane Smith','JSS1/002',9,10,90)`);

  // Test RPC sync single
  try{
    const syncRes = await db.query(`select public.sc_assignment_cbt_sync('d6000000-0000-4000-8000-000000000001') as res`);
    const res = syncRes.rows[0].res;
    ok('sc_assignment_cbt_sync syncs scores', res.ok===true && res.synced>=2, JSON.stringify(res));
  }catch(e){
    ok('sc_assignment_cbt_sync exists and syncs', false, e.message.slice(0,200));
  }

  // Test totals
  try{
    const totals = await db.query(`select public.sc_assignment_totals('JSS1','Mathematics','First Term','2024/2025') as res`);
    const t = totals.rows[0].res;
    ok('sc_assignment_totals returns cumulative totals', t.ok===true && t.totals.length>=2, JSON.stringify(t).slice(0,200));
  }catch(e){
    ok('sc_assignment_totals works', false, e.message.slice(0,200));
  }

  // Test sync all
  try{
    const allSync = await db.query(`select public.sc_assignment_cbt_sync_all('JSS1','Mathematics','First Term','2024/2025') as res`);
    const r = allSync.rows[0].res;
    ok('sc_assignment_cbt_sync_all syncs multiple CBT assignments', r.ok===true && r.exams_synced>=1, JSON.stringify(r).slice(0,200));
  }catch(e){
    ok('sc_assignment_cbt_sync_all works', false, e.message.slice(0,200));
  }

  // Test that assignment_scores has separate columns per cbt_exam_id (cumulative)
  const scores = await db.query(`select * from public.assignment_scores where class='JSS1' and subject='Mathematics'`);
  ok('assignment_scores has rows with cbt_exam_id for cumulative collation', scores.rows.length>=2 && scores.rows.some(r=>r.cbt_exam_id), `found ${scores.rows.length} rows`);

  // Test drive_link for student Take
  const withLink = await db.query(`select * from public.assignments where is_cbt=true and drive_link is not null`);
  ok('CBT assignment mirrors have drive_link for student Take button', withLink.rows.length>=1 && withLink.rows[0].drive_link.includes('cbt-exam.html'), withLink.rows[0]?.drive_link);

  const failed = tests.filter(t=>!t.cond);
  console.log(`\nAssignment CBT tests: ${tests.length - failed.length}/${tests.length} passed`);
  if(failed.length){
    console.log('Failed:', failed.map(f=>f.name).join(', '));
    process.exit(1);
  }
}

run().catch(e=>{ console.error(e); process.exit(1); });
