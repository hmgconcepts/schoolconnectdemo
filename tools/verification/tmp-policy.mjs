/* V12.66 — report presentation policy: can the school switch positions off,
   per report type and per term, and withhold ONE learner without touching
   anyone else's marks? */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { schemaText } from './schema-loader.mjs';

const require = createRequire(import.meta.url);
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m, extra !== undefined ? JSON.stringify(extra) : ''); } };
const j = v => JSON.parse(JSON.stringify(v));

const HERE = new URL('.', import.meta.url).pathname;
const S = p => schemaText(HERE + '../../database/' + p);
await db.exec(readFileSync(HERE + 'pglite-boot.sql', 'utf8'));
const ADMIN = '11111111-1111-1111-1111-111111111111';
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
try { await db.exec(S('complete-schema.sql')); }
catch (e) { console.log('SCHEMA FAILED', e.message); process.exit(1); }

const S1 = '22222222-2222-2222-2222-222222222222';
const S2 = '33333333-3333-3333-3333-333333333333';

async function seed() {
  await db.exec(`
    insert into auth.users(id,email) values ('${ADMIN}','boss@x.test')
      on conflict (id) do nothing;
    insert into public.profiles(id,full_name,role,status,email)
      values ('${ADMIN}','Boss','admin','approved','boss@x.test') on conflict (id) do update set role='admin',status='approved';
    insert into public.students(id,full_name,class,admission_no,status)
      values ('${S1}','Ada Obi','JSS 1','ADM001','active'),
             ('${S2}','Bola Ade','JSS 1','ADM002','active')
      on conflict (id) do nothing;
    insert into public.academic_periods(term,session,is_current,starts_on,ends_on)
      values ('First Term','2025/2026',true,'2025-09-01','2025-12-10') on conflict do nothing;
  `);
}
async function asAdmin() {
  await db.exec(`select set_config('request.jwt.claim.sub','${ADMIN}',false)`);
}
const call = async (fn, args) => j((await db.query(`select public.${fn}(${args}) as r`)).rows[0].r);

await seed(); await asAdmin();
console.log('\n=== A. policy defaults to "show" for a school that never opened the switch ===');
let p = await call('sc_report_policy', `'terminal',null,null`);
ok(p.ok === true, 'sc_report_policy answers');
ok(p.show_position === true, 'position is shown by default (old behaviour preserved)', p.show_position);
ok(p.configured === false, 'and is reported as not-yet-configured', p.configured);

console.log('\n=== B. an admin switches positions OFF for terminal reports ===');
let sv = await call('sc_report_policy_save',
  `'terminal','First Term','2025/2026', false, true, true, true, 'Rank'`);
ok(sv.ok === true, 'save accepted', sv);
p = await call('sc_report_policy', `'terminal','First Term','2025/2026'`);
ok(p.show_position === false, 'position is now OFF', p.show_position);
ok(p.position_label === 'Rank', 'the label the school chose is stored', p.position_label);
ok(p.configured === true, 'reported as configured', p.configured);

console.log('\n=== C. the switch is per report type — midterm is untouched ===');
let m = await call('sc_report_policy', `'midterm','First Term','2025/2026'`);
ok(m.show_position === true, 'midterm still shows positions (independent switch)', m.show_position);
ok(m.configured === false, 'midterm has no setting of its own', m.configured);

console.log('\n=== D. the switch is per term — next term is untouched ===');
let t2 = await call('sc_report_policy', `'terminal','Second Term','2025/2026'`);
ok(t2.show_position === true, 'Second Term falls back to the default (shown)', t2.show_position);

console.log('\n=== E. grades and remarks can be switched independently ===');
await call('sc_report_policy_save', `'terminal','First Term','2025/2026', true, false, false, false, 'Position in class'`);
p = await call('sc_report_policy', `'terminal','First Term','2025/2026'`);
ok(p.show_position === true && p.show_grade === false && p.show_remarks === false,
   'a school can print the position but hide grades and remarks', p);
// restore
await call('sc_report_policy_save', `'terminal','First Term','2025/2026', false, true, true, true, 'Position in class'`);

console.log('\n=== F. one learner can be withheld without touching anyone else ===');
let h1 = await call('sc_report_hold_position', `'ADM001','JSS 1','First Term','2025/2026','terminal','mark under appeal',true`);
ok(h1.ok === true && h1.held === true, 'hold placed on Ada', h1);
const holds = j((await db.query(`select student_id_ref,class,term,session,kind,reason from public.sc_report_position_hold`)).rows);
ok(holds.length === 1, 'exactly one hold row exists', holds);
ok(holds[0].student_id_ref === 'ADM001', 'the hold names Ada, not Bola', holds[0].student_id_ref);
ok(holds[0].reason === 'mark under appeal', 'the reason is kept for the record', holds[0].reason);

console.log('\n=== G. placing the same hold twice does not duplicate it ===');
await call('sc_report_hold_position', `'ADM001','JSS 1','First Term','2025/2026','terminal','still under appeal',true`);
const holds2 = j((await db.query(`select * from public.sc_report_position_hold`)).rows);
ok(holds2.length === 1, 'still exactly one hold row (upsert, not append)', holds2.length);
ok(holds2[0].reason === 'still under appeal', 'the reason was updated in place', holds2[0].reason);

console.log('\n=== H. releasing the hold restores the position ===');
let h2 = await call('sc_report_hold_position', `'ADM001','JSS 1','First Term','2025/2026','terminal','',false`);
ok(h2.ok === true && h2.held === false, 'hold released', h2);
const holds3 = j((await db.query(`select * from public.sc_report_position_hold`)).rows);
ok(holds3.length === 0, 'no holds remain', holds3.length);

console.log('\n=== I. the listing view joins the learner name ===');
await call('sc_report_hold_position', `'ADM002','JSS 1','First Term','2025/2026','terminal','bereavement',true`);
const vl = j((await db.query(`select student_name,student_id_ref from public.sc_report_hold_list`)).rows);
ok(vl.length === 1 && vl[0].student_name === 'Bola Ade', 'the view names the learner', vl);

console.log('\n=== J. a hold is scoped — it does not leak to another report kind ===');
const midHolds = j((await db.query(`select * from public.sc_report_position_hold where kind='midterm'`)).rows);
ok(midHolds.length === 0, 'the terminal hold does not suppress the midterm position', midHolds.length);

console.log('\n=== K. a non-admin cannot reach the switch ===');
await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
const denied = await call('sc_report_policy_save', `'terminal','First Term','2025/2026', true, true, true, true, 'x'`);
ok(denied.ok === false, 'anonymous save is refused', denied);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
