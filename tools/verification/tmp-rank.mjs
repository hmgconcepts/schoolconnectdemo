/* V12.64 — THE RANKING BUG, reproduced before it is fixed.

   The report says: "students who do fewer subjects get higher overall
   percentages and better positions". Two independent defects produce that.

   The class is JSS 2 with three students and a 4-subject midterm:

     Ada     offered 4 subjects   raw marks 34 + 30 + 38 + 36 = 138 / 400
     Bola    offered 4 subjects   raw marks 30 + 28 + 32 + 30 = 120 / 400
     Chidi   offered 1 subject    raw marks 38 / 100

   Correct percentages: Ada 34.5 %, Bola 30.0 %, Chidi 38.0 %
   Correct positions  : Chidi 1st, Ada 2nd, Bola 3rd          <- still "wrong"
   ... but that is only because Chidi sat 1 paper out of 4.

   A midterm report must therefore measure against what the learner was
   EXPECTED to sit (the class assessment structure), not what they happened to
   submit. Against 4 subjects:

     Ada   138/400 = 34.50 %   complete
     Bola  120/400 = 30.00 %   complete
     Chidi  38/400 =  9.50 %   INCOMPLETE (1 of 4 papers) -> must be flagged,
                                 must not be ranked above a complete candidate
*/
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const FULL = HERE + '../../database/complete-schema.sql';
const PACK = process.argv[2] || '';

const ADA = 'e1000000-0000-4000-8000-000000000001';
const BOLA = 'e1000000-0000-4000-8000-000000000002';
const CHIDI = 'e1000000-0000-4000-8000-000000000003';
const SUBJECTS = ['Mathematics', 'English Language', 'Basic Science', 'Social Studies'];

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (extra ? '  [' + extra + ']' : '')); }
}

async function build() {
  const db = await PGlite.create();
  await db.exec(fs.readFileSync(HERE + 'pglite-boot.sql', 'utf8'));
  await db.exec(schemaText(FULL));
  if (PACK) await db.exec(schemaText(PACK));
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('app.uid',true),'')::uuid $f$;`);
  await db.exec(`select set_config('app.uid','11111111-1111-1111-1111-111111111111',false);`);
  await db.exec(`
    insert into auth.users(id,email) values('11111111-1111-1111-1111-111111111111','a@x.com') on conflict do nothing;
    update public.profiles set role='admin',status='approved' where id='11111111-1111-1111-1111-111111111111';
    insert into public.students(id,full_name,class,arm,admission_no,status) values
      ('${ADA}','Ada Obi','JSS 2','A','R/1','active'),
      ('${BOLA}','Bola Ade','JSS 2','A','R/2','active'),
      ('${CHIDI}','Chidi Eze','JSS 2','A','R/3','active') on conflict (id) do nothing;
  `);
  return db;
}

async function seedScores(db) {
  // one midterm column per subject -> 4 subjects expected of every JSS 2 learner
  const COLS = [];
  for (let i = 0; i < SUBJECTS.length; i++) {
    const id = `c1000000-0000-4000-8000-00000000000${i + 1}`;
    await db.exec(`
      insert into public.assessment_columns(id,class,subject,term,session,name,max_mark,position,cbt_assessment_type)
      values('${id}','JSS 2','${SUBJECTS[i]}','First Term','2025/2026','Midterm',100,${i},'midterm')
      on conflict (id) do update set cbt_assessment_type='midterm';
    `);
    COLS.push([id, SUBJECTS[i]]);
  }
  const rows = [
    [ADA, 'Ada Obi', 'R/1', [34, 30, 38, 36]],
    [BOLA, 'Bola Ade', 'R/2', [30, 28, 32, 30]],
    [CHIDI, 'Chidi Eze', 'R/3', [38, null, null, null]]
  ];
  for (const [sid, name, ref, marks] of rows) {
    for (let i = 0; i < COLS.length; i++) {
      if (marks[i] === null) continue;
      await db.exec(`
        insert into public.report_scores(student_id,student_id_ref,student_name,class,subject,term,session,column_id,score)
        values('${sid}','${ref}','${name}','JSS 2','${COLS[i][1]}','First Term','2025/2026','${COLS[i][0]}',${marks[i]})
        on conflict do nothing;
      `);
    }
  }
}

function show(label, rows) {
  console.log('\n  ' + label);
  for (const r of rows) {
    console.log('    %s  total=%s  pct=%s  pos=%s  expected=%s  complete=%s',
      String(r.student_name || r.name || '').padEnd(12),
      String(r.total).padStart(6),
      String(r.percentage ?? r.pct ?? '-').padStart(6),
      String(r.position ?? '-').padStart(4),
      String(r.subjects_expected ?? '-').padStart(4),
      String(r.complete ?? (r.subjects_sat != null ? (r.subjects_sat + '/' + r.subjects_expected) : '-')).padStart(8));
  }
}

console.log('\n=== V12.64 midterm ranking regression ===\n');
const db = await build();
await seedScores(db);

const gen = await db.query(`select public.generate_midterm_reports('JSS 2','First Term','2025/2026') as r`);
console.log('  generate_midterm_reports ->', JSON.stringify(gen.rows[0].r));

const probe = await db.query(`select * from public.midterm_report_cards order by student_name`);
show('BEFORE-FIX state (midterm_report_cards):', probe.rows);

// --- what a correct engine must produce ------------------------------------
const ada = probe.rows.find(r => r.student_name === 'Ada Obi');
const bola = probe.rows.find(r => r.student_name === 'Bola Ade');
const chidi = probe.rows.find(r => r.student_name === 'Chidi Eze');

console.log('\n=== assertions ===');

ok(!!ada && !!bola && !!chidi, 'three report cards were generated');

// 1. percentage must be measured against the FULL expected subject load
const pct = r => Number(r && (r.percentage ?? r.percent ?? NaN));
if (Number.isFinite(pct(ada))) {
  ok(Math.abs(pct(ada) - 34.5) < 0.5, 'Ada percentage = 34.5% of her full 4-subject load', 'got ' + pct(ada));
  ok(Math.abs(pct(bola) - 30.0) < 0.5, 'Bola percentage = 30.0% of her full 4-subject load', 'got ' + pct(bola));
  ok(Math.abs(pct(chidi) - 9.5) < 0.5, 'Chidi percentage = 9.5% of the same 4-subject load (not 38%)', 'got ' + pct(chidi));
} else {
  ok(false, 'a percentage column exists on midterm_report_cards',
     'columns: ' + Object.keys(probe.rows[0] || {}).join(','));
  ok(false, 'Ada percentage = 34.5%');
  ok(false, 'Chidi percentage is not inflated by offering one subject');
}

// 2. ranking must not reward a thin subject load
if (ada && chidi && ada.position != null) {
  // null position = deliberately unranked (provisional). Either outcome is
  // acceptable for Chidi; what must NEVER happen is Chidi above Ada.
  const chidiAbove = chidi.position != null && Number(chidi.position) < Number(ada.position);
  ok(!chidiAbove, 'Chidi (1 of 4 subjects) does NOT rank above Ada (4 of 4)',
     'chidi=' + chidi.position + ' ada=' + ada.position);
  ok(chidi.position == null || Number(chidi.position) > Number(ada.position),
     'Chidi is either unranked or placed below Ada', 'chidi=' + chidi.position);
} else {
  ok(false, 'Ada is ranked');
}

// 3. an incomplete candidate must be flagged, not silently ranked as a winner
const chidiFlags = Object.keys(chidi || {}).filter(k => /complete|expected|sat|incomplete|provisional/i.test(k));
ok(chidiFlags.length > 0, 'the card records subject completeness', 'columns: ' + Object.keys(chidi || {}).join(','));
if (chidiFlags.some(k => 'subjects_sat' === k) && chidiFlags.some(k => 'subjects_expected' === k)) {
  ok(Number(chidi.subjects_sat) === 1 && Number(chidi.subjects_expected) === 4,
     'Chidi recorded as 1 of 4 subjects', chidi.subjects_sat + '/' + chidi.subjects_expected);
  ok(Number(ada.subjects_sat) === 4 && Number(ada.subjects_expected) === 4,
     'Ada recorded as 4 of 4 subjects', ada.subjects_sat + '/' + ada.subjects_expected);
}

// 4. every card must carry a rank basis that a school can defend
const basis = Object.keys(ada || {}).filter(k => /basis|rank_scope|cohort/i.test(k));
ok(basis.length > 0, 'the card records WHICH cohort the rank was computed in', 'columns: ' + Object.keys(ada || {}).join(','));

console.log('\n  ' + (fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)') + '  (' + pass + ' passed)\n');
await db.close();
process.exit(fail === 0 ? 0 : 1);
