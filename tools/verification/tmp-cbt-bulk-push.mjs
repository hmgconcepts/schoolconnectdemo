/* V12.70 — BULK PUSH CBT SCORES: no timeout, exact arithmetic.
   ------------------------------------------------------------------
   The school reported:

     "❌ Bulk push not committed … canceling statement due to statement timeout"

   Nothing was committed, so no data was at risk — but the feature was unusable
   on a real school. The cause was a CORRELATED SUBQUERY inside the batch RPC:
   for every candidate score row it re-scanned report_scores to recover the
   student's existing display name. Thousands of index probes inside one
   statement, and Postgres cancelled the whole batch.

   This harness proves, on a real Postgres:
     1. the batch really commits the right scores (not just "no error");
     2. the destination column is created once and reused;
     3. re-running the same push is idempotent (no duplicate rows);
     4. the display-name lookup is now a single set-based pass, so the number
        of times report_scores is scanned does not grow with the row count.
   ========================================================================= */
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
await db.exec(`insert into auth.users(id,email) values('${ADM}','admin@x.t') on conflict do nothing;
  insert into profiles(id,full_name,role,status) values('${ADM}','Bursar','admin','approved')
    on conflict(id) do update set role='admin',status='approved';`);
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ADM]);

/* ---- a realistic school: 60 learners, three CBTs, all with results ---- */
const N = 60;
const students = [];
for (let i = 1; i <= N; i++) {
  const id = `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`;
  students.push({ id, adm: `GOSA/2026/${String(i).padStart(4, '0')}`, name: `Learner ${i}` });
}
for (const s of students)
  await db.query(`insert into students(id,full_name,class,status,admission_no) values($1,$2,'JSS 1','active',$3)`,
    [s.id, s.name, s.adm]);

const exams = [];
for (let e = 1; e <= 3; e++) {
  const id = `bbbbbbbb-0000-0000-0000-${String(e).padStart(12, '0')}`;
  const bank = JSON.stringify([
    { question: 'Q1', options: ['a', 'b', 'c', 'd'], answer: 'a', type: 'mcq', mark: 1 },
    { question: 'Q2', options: ['a', 'b', 'c', 'd'], answer: 'b', type: 'mcq', mark: 1 },
  ]);
  await db.query(`insert into cbt_exams(id,code,title,subject,class,term,session,assessment_type,csv_data,questions,teacher_id,is_open,max_score,report_column)
     values($1,$2,$3,'Mathematics','JSS 1','First Term','2026/2027','exam',$4::jsonb,$4::jsonb,$5,true,20,$6)`,
    [id, 'EX0' + e, 'CBT ' + e, bank, ADM, 'CBT Test ' + e]);
  exams.push(id);
  for (const s of students) {
    await db.query(`insert into cbt_results(exam_id,student_id,student_id_ref,student_name,score,total,percent,grading_status,engine_version,subject_scores)
       values($1,$2,$3,$4,16,20,80,'graded','v5.1.3','{}'::jsonb)`, [id, s.id, s.adm, s.name]);
  }
}
const before = Number((await db.query(`select count(*) c from cbt_results`)).rows[0].c);
ok(before === N * 3, `seeded ${N * 3} CBT results across 3 exams`, before);

/* ---- the push the bursar clicks ---- */
const t0 = Date.now();
const res = await db.query(`select sc_cbt_bulk_push_batch_v1($1::uuid[], null, true, 20, true, 'best', null, false) as r`, [exams]);
const ms = Date.now() - t0;
const out = res.rows[0].r;
ok(out && out.ok === true, 'the batch push committed', out);
ok(Number(out.saved) === N * 3, `all ${N * 3} score rows were written`, out && out.saved);
ok(Number(out.created_columns) === 3, 'one destination column was created per exam (each CBT owns its own column)', out && out.created_columns);
ok(ms < 20000, `the batch finished in ${ms} ms (a statement timeout is 8s+ of work before cancellation)`, ms);

const rows = await db.query(`select count(*) c from report_scores`);
ok(Number(rows.rows[0].c) === N * 3, 'report_scores holds exactly one row per student per exam', rows.rows[0].c);

const sample = await db.query(`select score, subject, term, session, class from report_scores order by score desc limit 1`);
ok(Number(sample.rows[0].score) === 16, '80% of a 20-mark column is 16 — the arithmetic scaled correctly', sample.rows[0]);
ok(sample.rows[0].term === 'First Term' && sample.rows[0].session === '2026/2027', 'the row carries the exam term and session', sample.rows[0]);

/* ---- idempotency: pushing again must not duplicate ---- */
const res2 = await db.query(`select sc_cbt_bulk_push_batch_v1($1::uuid[], null, true, 20, true, 'best', null, false) as r`, [exams]);
const out2 = res2.rows[0].r;
ok(out2 && out2.ok === true, 'a second push of the same exams also succeeds', out2);
const rows2 = await db.query(`select count(*) c from report_scores`);
ok(Number(rows2.rows[0].c) === N * 3, 'and the row count is unchanged — the push is idempotent', rows2.rows[0].c);
ok(Number(out2.created_columns) === 0, 'and no second set of columns was created', out2 && out2.created_columns);

/* ---- two DIFFERENT exams must never share one cell ---- */
const clash = await db.query(`select sc_cbt_bulk_push_batch_v1($1::uuid[], 'One Shared Column', true, 20, true, 'best', null, false) as r`, [exams]);
const outClash = clash.rows[0].r;
ok(outClash && outClash.ok === false && outClash.error === 'destination_conflict',
  'pushing different exams into ONE column is refused, not silently merged', outClash);
ok(/single cell/i.test(String(outClash.message || '')) && /own Report column/i.test(String(outClash.message || '')),
  'and the refusal says why and what to do', outClash && outClash.message);
const rowsClash = await db.query(`select count(*) c from report_scores`);
ok(Number(rowsClash.rows[0].c) === N * 3, 'and nothing was written by the refused batch', rowsClash.rows[0].c);

/* ---- the arithmetic the bursar relies on ---- */
const sum = await db.query(`select sum(score) s from report_scores`);
ok(Number(sum.rows[0].s) === N * 3 * 16, 'the total of every pushed score is exact', sum.rows[0].s);

/* ---- the de-correlation itself: no correlated subquery may remain ---- */
const def = (await db.query(`select prosrc from pg_proc where proname in ('sc_cbt_bulk_push_batch_v1','sc_cbt_bulk_push_exam_v2')`)).rows.map(r => r.prosrc).join('\n');
ok(!/coalesce\(\(select rs\.student_name/.test(def), 'neither push function resolves display names with a per-row correlated subquery');
ok(/left join/i.test(def) && /distinct on/i.test(def), 'both now use one set-based pass (LEFT JOIN + DISTINCT ON)');

/* ---- a missing destination with auto-create OFF must fail cleanly, not hang ---- */
const oneExam = [exams[0]];
const res3 = await db.query(`select sc_cbt_bulk_push_batch_v1($1::uuid[], 'No Such Column', false, 20, true, 'best', null, false) as r`, [oneExam]);
const out3 = res3.rows[0].r;
ok(out3 && out3.ok === false && /Missing report destination/i.test(String(out3.error || '')), 'a missing destination with auto-create off reports a clear error', out3);

/* ---- and that failed batch committed nothing ---- */
const rows3 = await db.query(`select count(*) c from report_scores`);
ok(Number(rows3.rows[0].c) === N * 3, 'the failed batch left the committed scores untouched', rows3.rows[0].c);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
