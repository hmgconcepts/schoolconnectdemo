/* Round 18 item 9 — "🔍 Audit All CBTs" kept reporting the same
   "186 CBTs — 34 with potential missing" even after the results were recovered.
   Two causes: the audit counted every exam with ZERO results as potentially
   missing (nothing can ever clear those), and has_missing compared raw row
   totals rather than asking which rostered learners still lack a result.
   This proves the figure is now honest and, crucially, that it CLEARS. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { schemaText } from './schema-loader.mjs';
const H = new URL('.', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : (fail++, console.log('  FAIL ' + m, x === undefined ? '' : JSON.stringify(x))); };

const db = await PGlite.create();
await db.exec(fs.readFileSync(H + 'pglite-boot.sql', 'utf8'));
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
await db.exec(schemaText(H + '../../database/complete-schema.sql'));
const q = async s => (await db.query(s)).rows;
const one = async s => (await q(s))[0];
const ADM = '44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users(id,email) values('${ADM}','a@x.t') on conflict do nothing;
  insert into profiles(id,full_name,role,status) values('${ADM}','Admin','admin','approved')
    on conflict(id) do update set role='admin',status='approved';`);
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [ADM]);

const exam = async code => (await one(`insert into cbt_exams(code,title,subject,class,term,session,is_open)
  values('${code}','T','Physics','JSS 1','First Term','2026/2027',false) returning id`)).id;
const auditOf = async id => {
  const r = await one(`select public.cbt_audit_all_missing() a`);
  return (r.a.exams || []).find(e => e.id === id);
};

/* --- an exam that exists but nobody sat and nobody is rostered for ---------- */
const idle = await exam('IDLE-1');
const a0 = await auditOf(idle);
ok(Number(a0.missing_count) === 0, 'an untouched exam is NOT reported as missing', a0.missing_count);

/* --- an exam with a roster, everybody sat --------------------------------- */
const e1 = await exam('CBT-1');
await db.exec(`insert into cbt_roster(exam_id,student_id_ref,full_name) values
  ('${e1}','ADM001','Ada'),('${e1}','ADM002','Bola'),('${e1}','ADM003','Chidi')`);
await db.exec(`insert into cbt_results(exam_id,student_id_ref,student_name,score,total)
  values ('${e1}','ADM001','Ada',10,20),('${e1}','ADM002','Bola',12,20),('${e1}','ADM003','Chidi',9,20)`);
const a1 = await auditOf(e1);
ok(Number(a1.missing_count) === 0, 'a fully sat exam reports nothing missing', a1.missing_count);

/* --- one learner's paper is lost ------------------------------------------ */
await db.exec(`delete from cbt_results where exam_id='${e1}' and student_id_ref='ADM002'`);
const a2 = await auditOf(e1);
ok(Number(a2.missing_count) === 1, 'a lost paper is reported — exactly one', a2.missing_count);

/* --- recovering it MUST clear the figure ---------------------------------- */
await db.exec(`insert into cbt_results(exam_id,student_id_ref,student_name,score,total)
  values ('${e1}','ADM002','Bola',12,20)`);
const a3 = await auditOf(e1);
ok(Number(a3.missing_count) === 0, 'AFTER RECOVERY THE AUDIT CLEARS — 0 missing', a3.missing_count);

/* --- the platform-wide count must be exactly zero now --------------------- */
const all = await one(`select public.cbt_audit_all_missing() a`);
const exams = all.a.exams || [];
const flagged = exams.filter(e => Number(e.missing_count || 0) > 0 || Number(e.pending_server || 0) > 0);
ok(flagged.length === 0, 'no exam is flagged "potential missing" once everything is complete',
   flagged.map(e => e.code + ':' + e.missing_count));
ok(exams.length === 2, 'both exams are still audited (nothing is hidden)', exams.length);

/* --- a rewound roster still counts, so the check cannot be gamed ---------- */
await db.exec(`insert into cbt_roster(exam_id,student_id_ref,full_name) values ('${e1}','ADM004','Dayo')`);
const a4 = await auditOf(e1);
ok(Number(a4.missing_count) === 1, 'a newly rostered learner with no paper shows up again', a4.missing_count);

console.log(`audit missing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
