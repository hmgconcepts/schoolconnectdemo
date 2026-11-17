/* V12.64 — the edge cases a school will actually hit, asserted.

   Covers what the reported bug did not mention:
     1. exact ties                     -> competition ranking 1,1,3 and a stable order
     2. a learner who sat nothing      -> no grade, no percentage, no position
     3. a learner below participation  -> provisional, unranked
     4. a learner missing one subject  -> ranked but flagged incomplete
     5. terminal reports               -> identical treatment to midterm
     6. re-running                     -> byte-identical output (idempotent)
     7. the one-button repair          -> finds the damage and fixes it
     8. explain                        -> every rank can be defended
*/
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const FULL = HERE + '../../database/complete-schema.sql';
const PACK = process.argv[2] || '';

const SUBJECTS = ['Mathematics', 'English Language', 'Basic Science', 'Social Studies'];
const STU = {
  T1: 'e2000000-0000-4000-8000-000000000001', // exact tie with T2
  T2: 'e2000000-0000-4000-8000-000000000002',
  T3: 'e2000000-0000-4000-8000-000000000003', // third, below the tie
  NS: 'e2000000-0000-4000-8000-000000000004', // sat nothing
  LO: 'e2000000-0000-4000-8000-000000000005', // sat 1 of 4  -> below participation
  PX: 'e2000000-0000-4000-8000-000000000006'  // sat 3 of 4  -> ranked but incomplete
};

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + (x ? '  [' + x + ']' : '')); } };

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
      ('${STU.T1}','Aaron Tie','JSS 3','A','E/1','active'),
      ('${STU.T2}','Bella Tie','JSS 3','A','E/2','active'),
      ('${STU.T3}','Cara Third','JSS 3','A','E/3','active'),
      ('${STU.NS}','Nadia Noshow','JSS 3','A','E/4','active'),
      ('${STU.LO}','Lola Low','JSS 3','A','E/5','active'),
      ('${STU.PX}','Peter Partial','JSS 3','A','E/6','active') on conflict (id) do nothing;
  `);
  return db;
}

async function seed(db) {
  // 4 midterm columns + 4 terminal columns
  for (let i = 0; i < SUBJECTS.length; i++) {
    await db.exec(`insert into public.assessment_columns(id,class,subject,term,session,name,max_mark,position,cbt_assessment_type)
      values('d1000000-0000-4000-8000-00000000000${i + 1}','JSS 3','${SUBJECTS[i]}','First Term','2025/2026','Midterm',100,${i},'midterm') on conflict (id) do nothing;`);
    await db.exec(`insert into public.assessment_columns(id,class,subject,term,session,name,max_mark,position,cbt_assessment_type)
      values('d2000000-0000-4000-8000-00000000000${i + 1}','JSS 3','${SUBJECTS[i]}','First Term','2025/2026','Exam',100,${i},'exam') on conflict (id) do nothing;`);
  }
  const mid = (i) => `d1000000-0000-4000-8000-00000000000${i + 1}`;
  const fin = (i) => `d2000000-0000-4000-8000-00000000000${i + 1}`;
  const put = async (sid, name, ref, marks, kind) => {
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] == null) continue;
      await db.exec(`insert into public.report_scores(student_id,student_id_ref,student_name,class,subject,term,session,column_id,score)
        values('${sid}','${ref}','${name}','JSS 3','${SUBJECTS[i]}','First Term','2025/2026','${kind === 'terminal' ? fin(i) : mid(i)}',${marks[i]})`);
    }
  };
  // midterm: T1 and T2 identical (60 each -> 240/400 = 60%), T3 lower
  await put(STU.T1, 'Aaron Tie', 'E/1', [60, 60, 60, 60], 'mid');
  await put(STU.T2, 'Bella Tie', 'E/2', [60, 60, 60, 60], 'mid');
  await put(STU.T3, 'Cara Third', 'E/3', [50, 50, 50, 50], 'mid');
  // NS: nothing at all
  // LO: 1 of 4 -> 90% raw, but only 1 assessment sat (0.25 < 0.34) -> must be unranked
  await put(STU.LO, 'Lola Low', 'E/5', [90, null, null, null], 'mid');
  // PX: 3 of 4 -> 0.75 participation -> ranked, flagged incomplete
  await put(STU.PX, 'Peter Partial', 'E/6', [40, 40, 40, null], 'mid');

  // terminal scores, same shape but different numbers
  await put(STU.T1, 'Aaron Tie', 'E/1', [70, 70, 70, 70], 'terminal');
  await put(STU.T2, 'Bella Tie', 'E/2', [65, 65, 65, 65], 'terminal');
  await put(STU.T3, 'Cara Third', 'E/3', [55, 55, 55, 55], 'terminal');
  await put(STU.PX, 'Peter Partial', 'E/6', [80, 80, null, null], 'terminal'); // 2 of 4 = 50% -> ranked
}

console.log('\n=== V12.64 edge cases ===\n');
const db = await build();
await seed(db);

console.log('--- midterm ---');
const g = await db.query(`select public.generate_midterm_reports('JSS 3','First Term','2025/2026') r`);
const mid = (await db.query(`select * from public.midterm_report_cards order by student_name`)).rows;
for (const r of mid) console.log('   %s  pct=%s  pos=%s  sub=%s/%s  as=%s/%s  rankable=%s',
  r.student_name.padEnd(14), String(r.percentage).padStart(6), String(r.position).padStart(4),
  r.subjects_sat, r.subjects_expected, r.assessments_sat, r.assessments_expected, r.rankable);
const M = Object.fromEntries(mid.map(r => [r.student_name, r]));

ok(M['Aaron Tie'].position === 1 && M['Bella Tie'].position === 1,
  'exact ties share 1st place (competition ranking)', 'aaron=' + M['Aaron Tie'].position + ' bella=' + M['Bella Tie'].position);
ok(M['Cara Third'].position === 3,
  'the place after a two-way tie is skipped (1,1,3) — international convention', 'got ' + M['Cara Third'].position);
ok(M['Aaron Tie'].tie_group === M['Bella Tie'].tie_group && M['Cara Third'].tie_group !== M['Aaron Tie'].tie_group,
  'tied learners share a tie_group and others do not');
ok(Math.abs(Number(M['Aaron Tie'].percentage) - 60) < 0.01,
  'a four-subject learner is measured on 240/400 = 60.00%', 'got ' + M['Aaron Tie'].percentage);

ok(M['Nadia Noshow'].position === null && Number(M['Nadia Noshow'].percentage) === 0,
  'a learner who sat nothing gets no percentage and no position',
  'pct=' + M['Nadia Noshow'].percentage + ' pos=' + M['Nadia Noshow'].position);
ok(M['Nadia Noshow'].grade === '',
  'a learner who sat nothing is NOT graded F — they are ungraded', 'grade="' + M['Nadia Noshow'].grade + '"');

ok(Number(M['Lola Low'].percentage) === 22.5,
  'a one-paper partial scores 90/400 = 22.50%, not 90%', 'got ' + M['Lola Low'].percentage);
ok(M['Lola Low'].position === null,
  'a learner below the participation threshold is not ranked', 'pos=' + M['Lola Low'].position);
ok(M['Lola Low'].rankable === false && /participation/i.test(M['Lola Low'].rank_basis || ''),
  'the reason is recorded on the card', M['Lola Low'].rank_basis);

ok(M['Peter Partial'].position != null,
  'a learner who sat 3 of 4 (above threshold) IS ranked', 'pos=' + M['Peter Partial'].position);
ok(M['Peter Partial'].complete === false && /incomplete/i.test(M['Peter Partial'].rank_basis || ''),
  'but is flagged incomplete with a recorded reason', M['Peter Partial'].rank_basis);
ok(Number(M['Peter Partial'].percentage) === 30,
  'and measured at 120/400 = 30.00%', 'got ' + M['Peter Partial'].percentage);

ok(M['Aaron Tie'].rank_cohort_size === 4,
  'the cohort size counts only ranked candidates (T1,T2,T3,PX)', 'got ' + M['Aaron Tie'].rank_cohort_size);

// idempotence
const before = JSON.stringify((await db.query(`select id,percentage,position,grade,rank_basis from public.midterm_report_cards order by student_id_ref`)).rows);
await db.query(`select public.generate_midterm_reports('JSS 3','First Term','2025/2026')`);
const after = JSON.stringify((await db.query(`select id,percentage,position,grade,rank_basis from public.midterm_report_cards order by student_id_ref`)).rows);
ok(before === after, 're-generating produces identical percentages and positions (idempotent)');

// terminal
console.log('\n--- terminal ---');
const tg = await db.query(`select public.sc_generate_terminal_reports('JSS 3','First Term','2025/2026') r`);
const term = (await db.query(`select * from public.report_cards order by student_name`)).rows;
for (const r of term) console.log('   %s  pct=%s  pos=%s  sub=%s/%s  rankable=%s',
  r.student_name.padEnd(14), String(r.percentage).padStart(6), String(r.position).padStart(4),
  r.subjects_sat, r.subjects_expected, r.rankable);
const T = Object.fromEntries(term.map(r => [r.student_name, r]));
ok(Math.abs(Number(T['Aaron Tie'].percentage) - 70) < 0.01,
  'terminal: 280/400 = 70.00%', 'got ' + T['Aaron Tie'].percentage);
ok(T['Aaron Tie'].position === 1 && T['Bella Tie'].position === 2,
  'terminal: 70% beats 65% and ranks 1st', 'aaron=' + T['Aaron Tie'].position + ' bella=' + T['Bella Tie'].position);
ok(T['Nadia Noshow'].position === null,
  'terminal: a no-show is unranked', 'pos=' + T['Nadia Noshow'].position);
ok(Number(T['Peter Partial'].percentage) === 40,
  'terminal: 160/400 = 40.00% — a missing paper costs the marks', 'got ' + T['Peter Partial'].percentage);

// repair finds the damage
console.log('\n--- one-button repair ---');
await db.exec(`update public.midterm_report_cards set percentage = round((total/nullif(max_total,0))*100,2), position = 1 where student_name='Lola Low';`);
const dry = await db.query(`select public.sc_reports_recompute('JSS 3','First Term','2025/2026',true) r`);
ok(Number(dry.rows[0].r.finding_count) > 0, 'dry run detects the deliberately corrupted card',
  'findings=' + dry.rows[0].r.finding_count);
const fixed = await db.query(`select public.sc_reports_recompute('JSS 3','First Term','2025/2026',false) r`);
ok(fixed.rows[0].r.ok === true, 'repair runs');
const afterFix = (await db.query(`select * from public.midterm_report_cards where student_name='Lola Low'`)).rows[0];
ok(Number(afterFix.percentage) === 22.5 && afterFix.position === null,
  'repair restores the correct percentage and removes the false 1st place',
  'pct=' + afterFix.percentage + ' pos=' + afterFix.position);

// explain
const ex = await db.query(`select public.sc_report_explain('E/1','JSS 3','First Term','2025/2026','midterm') r`);
ok(ex.rows[0].r.ok === true && /out of an expected/.test(ex.rows[0].r.working || ''),
  'explain() states the working for any rank', ex.rows[0].r.working);

console.log('\n  ' + (fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)') + '  (' + pass + ' passed)\n');
await db.close();
process.exit(fail === 0 ? 0 : 1);
