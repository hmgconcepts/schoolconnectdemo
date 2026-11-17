/* V12.70 — ITEM 10: THE CBT RE-MAPPED TO A DIFFERENT REPORT COLUMN.
   ---------------------------------------------------------------------
   Reported:
     "A teacher mapped a CBT to the wrong report column, students sat it, the
      results were pushed. He then changed the column to the correct one,
      regraded and pushed again. Regenerating the mid-term report still shows
      the WRONG column — and now shows the CBT TWICE, once per column."

   Two independent causes, both proved here:

     1. NOTHING MOVES THE OLD SCORE. `report_column` is edited on the exam row
        and the scores stay where they were pushed. A second push writes a
        second row under the new column. Both then feed the report.

     2. THE MID-TERM SHEET IS A SNAPSHOT. It is generated into
        midterm_report_cards as jsonb; changing the underlying columns does not
        touch a sheet that was already generated, so the old column keeps
        rendering until someone regenerates.

   `sc_report_remap_cbt` already existed to fix (1) — but nothing called it when
   the column was edited, which is why the bug survived. This harness proves the
   duplicate happens, then proves the fix removes it, and that a second run is a
   no-op.
   ========================================================================== */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { schemaText } from './schema-loader.mjs';

const H = new URL('.', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('  PASS', m)) : (fail++, console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x))); };

const db = await PGlite.create();
await db.exec(fs.readFileSync(H + 'pglite-boot.sql', 'utf8'));
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
await db.exec(schemaText(H + '../../database/complete-schema.sql'));

const ADM = '11111111-1111-1111-1111-111111111111';
const STU = 'aaaaaaaa-1111-1111-1111-111111111111';
await db.exec(`insert into auth.users(id,email) values('${ADM}','a@b.t') on conflict do nothing;
  insert into profiles(id,full_name,role,status) values('${ADM}','Bursar','admin','approved')
    on conflict(id) do update set role='admin',status='approved';
  insert into students(id,full_name,class,status,admission_no) values('${STU}','Test Learner','JSS 1','active','SC/001');`);
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ADM]);

const EXAM = '33333333-3333-3333-3333-333333333333';
const bank = JSON.stringify([{ question: 'Q1', options: ['a', 'b', 'c', 'd'], answer: 'a', type: 'mcq', mark: 1 }]);
/* the CBT was set up pointing at the WRONG column */
await db.query(`insert into cbt_exams(id,code,title,subject,class,term,session,assessment_type,csv_data,questions,teacher_id,is_open,max_score,report_column)
  values($1,'EX1','Midterm Test','Mathematics','JSS 1','Second Term','2026/2027','midterm',$2::jsonb,$2::jsonb,$3,true,20,'Test 1 (WRONG)')`,
  [EXAM, bank, ADM]);
await db.query(`insert into cbt_results(exam_id,student_id,student_id_ref,student_name,score,total,percent,grading_status,engine_version,subject_scores)
  values($1,$2,'SC/001','Test Learner',16,20,80,'graded','v5.1.3','{}'::jsonb)`, [EXAM, STU]);

/* ---- the mis-taken push: scores land in the WRONG column ---- */
const push1 = await db.query(`select sc_cbt_bulk_push_exam_v2($1,'Test 1 (WRONG)',true,20,true,'best',null,true) as r`, [EXAM]);
ok(push1.rows[0].r.ok === true, 'the first push committed into the wrong column', push1.rows[0].r);
const after1 = await db.query(`select ac.name, rs.score from report_scores rs join assessment_columns ac on ac.id=rs.column_id order by ac.name`);
ok(after1.rows.length === 1 && after1.rows[0].name === 'Test 1 (WRONG)',
  'one score sits in the wrong column', after1.rows);

/* ---- the tutor corrects the column and pushes again ---- */
await db.query(`update cbt_exams set report_column='Test 1 (RIGHT)' where id=$1`, [EXAM]);
const push2 = await db.query(`select sc_cbt_bulk_push_exam_v2($1,'Test 1 (RIGHT)',true,20,true,'best',null,true) as r`, [EXAM]);
ok(push2.rows[0].r.ok === true, 'the second push committed into the right column', push2.rows[0].r);
const after2 = await db.query(`select ac.name, rs.score from report_scores rs join assessment_columns ac on ac.id=rs.column_id order by ac.name`);
ok(after2.rows.length === 2, 'THE BUG: the same CBT now has TWO score rows, one per column', after2.rows);

/* ---- the mid-term sheet is generated and shows it twice ---- */
const gen1 = await db.query(`select generate_midterm_reports('JSS 1','Second Term','2026/2027') as r`);
const sheet1 = await db.query(`select scores from midterm_report_cards where student_id_ref='SC/001'`);
const keys1 = Object.keys(sheet1.rows[0] && sheet1.rows[0].scores || {});
ok(gen1.rows[0].r && gen1.rows[0].r.ok !== false, 'the mid-term report generated', gen1.rows[0].r);
ok(keys1.some(k => /WRONG/.test(k)) && keys1.some(k => /RIGHT/.test(k)),
  'THE REPORTED SYMPTOM: the sheet lists the CBT under BOTH columns', keys1);

/* ---- the fix: remap moves the score and removes the stale one ---- */
const dry = await db.query(`select sc_report_remap_cbt($1,'Test 1 (RIGHT)',null,true) as r`, [EXAM]);
ok(dry.rows[0].r.ok === true && Number(dry.rows[0].r.moved) === 1,
  'a dry run reports exactly one score to move', dry.rows[0].r);
const stillTwo = await db.query(`select count(*) c from report_scores`);
ok(Number(stillTwo.rows[0].c) === 2, 'and a dry run changes nothing', stillTwo.rows[0].c);

const real = await db.query(`select sc_report_remap_cbt($1,'Test 1 (RIGHT)',null,false) as r`, [EXAM]);
ok(real.rows[0].r.ok === true, 'the remap committed', real.rows[0].r);
const after3 = await db.query(`select ac.name, rs.score from report_scores rs join assessment_columns ac on ac.id=rs.column_id order by ac.name`);
ok(after3.rows.length === 1, 'after the remap the CBT has exactly ONE score row', after3.rows);
ok(after3.rows[0].name === 'Test 1 (RIGHT)' && Number(after3.rows[0].score) === 16,
  'and it is the correct column, at the same score', after3.rows[0]);

/* ---- the sheet must be regenerated, not merely republished ---- */
const gen2 = await db.query(`select generate_midterm_reports('JSS 1','Second Term','2026/2027') as r`);
const sheet2 = await db.query(`select scores from midterm_report_cards where student_id_ref='SC/001'`);
const keys2 = Object.keys(sheet2.rows[0] && sheet2.rows[0].scores || {});
ok(!keys2.some(k => /WRONG/.test(k)), 'after regeneration the sheet no longer lists the wrong column', keys2);
ok(keys2.some(k => /RIGHT/.test(k)), 'and it lists the CBT once, under the correct column', keys2);

/* ---- idempotency ---- */
const again = await db.query(`select sc_report_remap_cbt($1,'Test 1 (RIGHT)',null,false) as r`, [EXAM]);
ok(again.rows[0].r.ok === true && Number(again.rows[0].r.moved) === 0,
  're-running the remap moves nothing — it is idempotent', again.rows[0].r);
const finalRows = await db.query(`select count(*) c from report_scores`);
ok(Number(finalRows.rows[0].c) === 1, 'and there is still exactly one row', finalRows.rows[0].c);

/* ==========================================================================
   THE FIX: changing the column ALONE (no second push) must move the scores.
   This is the scenario the school actually described.
   ========================================================================== */
console.log('\n=== the tutor edits the column on the exam row — nothing else ===');
const EXAM2 = '44444444-4444-4444-4444-444444444444';
await db.query(`insert into cbt_exams(id,code,title,subject,class,term,session,assessment_type,csv_data,questions,teacher_id,is_open,max_score,report_column)
  values($1,'EX2','Second Test','Mathematics','JSS 1','Second Term','2026/2027','midterm',$2::jsonb,$2::jsonb,$3,true,20,'Wrong Col')`,
  [EXAM2, bank, ADM]);
await db.query(`insert into cbt_results(exam_id,student_id,student_id_ref,student_name,score,total,percent,grading_status,engine_version,subject_scores)
  values($1,$2,'SC/001','Test Learner',12,20,60,'graded','v5.1.3','{}'::jsonb)`, [EXAM2, STU]);
await db.query(`select sc_cbt_bulk_push_exam_v2($1,'Wrong Col',true,20,true,'best',null,true)`, [EXAM2]);
/* the school creates the correct column before re-mapping (this is what the
   Report Cards page does when a tutor picks a destination that does not exist) */
await db.query(`insert into assessment_columns(class,subject,term,session,name,max_mark,weight,position,source)
  values('JSS 1','*','Second Term','2026/2027','Right Col',20,1,9,'cbt') on conflict do nothing`);
const pre = await db.query(`select ac.name from report_scores rs join assessment_columns ac on ac.id=rs.column_id where ac.name in ('Wrong Col','Right Col')`);
ok(pre.rows.length === 1 && pre.rows[0].name === 'Wrong Col', 'the score starts in the wrong column', pre.rows);

/* the edit the tutor makes in the CBT editor — a plain UPDATE of report_column */
await db.query(`update cbt_exams set report_column='Right Col' where id=$1`, [EXAM2]);
const post = await db.query(`select ac.name, rs.score from report_scores rs join assessment_columns ac on ac.id=rs.column_id where ac.name in ('Wrong Col','Right Col') order by ac.name`);
ok(post.rows.length === 1,
  'THE FIX: editing the column moved the score — there is still exactly ONE row', post.rows);
ok(post.rows.length === 1 && post.rows[0].name === 'Right Col' && Number(post.rows[0].score) === 12,
  'and it is now in the correct column, at the same score', post.rows);

/* and the audit trail records what happened */
const logged = await db.query(`select details from sc_install_state where key = $1`, ['v12.70-last-remap-' + EXAM2]);
const rec = logged.rows[0] && logged.rows[0].details;
ok(logged.rows.length === 1 && rec && Number(rec.result && rec.result.moved) === 1,
  'the move is recorded with its count', rec);

/* setting the column to the SAME value must not churn */
const before = await db.query(`select count(*) c from report_scores`);
await db.query(`update cbt_exams set report_column='Right Col' where id=$1`, [EXAM2]);
const afterSame = await db.query(`select count(*) c from report_scores`);
ok(Number(before.rows[0].c) === Number(afterSame.rows[0].c), 'saving the same column again changes nothing');

/* clearing the mapping must NOT move scores anywhere */
await db.query(`update cbt_exams set report_column='' where id=$1`, [EXAM2]);
const afterClear = await db.query(`select count(*) c from report_scores rs join assessment_columns ac on ac.id=rs.column_id where ac.name='Right Col'`);
ok(Number(afterClear.rows[0].c) === 1, 'removing the mapping leaves the existing score where it is', afterClear.rows[0].c);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
