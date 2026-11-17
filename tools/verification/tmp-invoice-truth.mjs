/* V12.67 — reproduction of the OLAYIWOLA / Afolabi screenshots.
   Three fee_payments rows for one learner (23,100 / 28,100 / 33,100 recorded
   totals, 10,000 / 5,000 / 5,000 paid). NO opening arrears entered.
   The Fees page shows a per-receipt snapshot; the dashboard shows the ledger.
   They must agree, and neither may invent a prior-term debt. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const S = p => schemaText(HERE + '../../database/' + p);

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m, extra !== undefined ? JSON.stringify(extra) : ''); } };
const num = v => Number(v || 0);

const db = await PGlite.create();
await db.exec(fs.readFileSync(HERE + 'pglite-boot.sql', 'utf8'));
const UID = '11111111-1111-1111-1111-111111111111';
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${UID}'::uuid $$;`);
await db.exec(S('complete-schema.sql'));
if (fs.existsSync(HERE + '../../database/v12.67-fee-invoice-truth.sql')) {
  await db.exec(S('v12.67-fee-invoice-truth.sql'));
}
await db.exec(`
  insert into auth.users(id,email) values ('${UID}','bursar@school.test') on conflict do nothing;
  insert into profiles(id,full_name,role,status) values ('${UID}','Bursar','admin','approved')
    on conflict (id) do update set role='admin', status='approved';
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const call = async (fn, args) => (await q(`select public.${fn}(${args}) as r`))[0].r;

const TOF = 'aaaaaaaa-1111-1111-1111-111111111111';
const LEK = 'bbbbbbbb-2222-2222-2222-222222222222';

console.log('\n=== 0. seed: one class, a dated calendar, a CURRENT-term structure ===');
await db.exec(`
  -- three dated past terms + the current one, exactly like a real calendar
  insert into academic_periods(term,session,is_current,starts_on,ends_on) values
    ('First Term','2024/2025',false,'2024-09-09','2024-12-13'),
    ('Second Term','2024/2025',false,'2025-01-13','2025-04-04'),
    ('Third Term','2024/2025',false,'2025-04-28','2025-07-25'),
    ('First Term','2025/2026',false,'2025-09-08','2025-12-12'),
    ('Second Term','2025/2026',false,'2026-01-12','2026-04-03'),
    ('Third Term','2025/2026',false,'2026-04-27','2026-07-24'),
    ('First Term','2026/2027',true,'2026-09-14','2026-12-11')
  on conflict do nothing;

  -- ONE fee structure, for the CURRENT term only — the normal case
  -- THE REAL CASE: the bursar leaves the term at its default label
  insert into class_fee_structure(class,term,session,total,tuition,exam_fee,development,active)
    values ('JSS 3','Current Term','2026/2027',28100,20000,3000,5100,true);

  insert into students(id,full_name,class,admission_no,status,created_at) values
    ('${TOF}','OLAYIWOLA TOFUNMI AJOKEADE','JSS 3','GOSA/2026/001','active','2026-09-01'),
    ('${LEK}','Afolabi Lekan','SSS 2','GOSA/2026/002','active','2026-09-01')
  on conflict (id) do nothing;
`);

console.log('\n=== 1. the Fees & Payments rows exactly as the screenshot shows them ===');
await db.exec(`
  insert into fee_payments(student_id,student_name,amount_paid,fee_total,method,term,session,payment_date)
  values
    ('${TOF}','OLAYIWOLA TOFUNMI AJOKEADE',10000,23100,'cash','First Term','2026/2027','2026-10-10'),
    ('${TOF}','OLAYIWOLA TOFUNMI AJOKEADE', 5000,28100,'cash','First Term','2026/2027','2026-10-25'),
    ('${TOF}','OLAYIWOLA TOFUNMI AJOKEADE', 5000,33100,'cash','First Term','2026/2027','2026-11-04');
`);

const led = await call('sc_fee_ledger_for', `'${TOF}',null,null`);
console.log('\n   ledger →', JSON.stringify({ bill: led.bill, paid: led.paid, balance: led.balance, arrears: led.arrears, total_due: led.total_due }));

console.log('\n=== 2. THE REPORTED FAULT: phantom "previous terms owing" ===');
ok(num(led.arrears) === 0,
   'no opening arrears entered ⇒ previous-terms-owing is ZERO, not 36,100', { arrears: led.arrears });
ok(num(led.bill) === 28100,
   'the term bill is the class structure for THIS term (28,100)', { bill: led.bill });
ok(num(led.total_due) === 8100,
   'total outstanding = 28,100 − 20,000 = 8,100', { total_due: led.total_due });

console.log('\n=== 3. the Fees page may NOT show a different bill from the dashboard ===');
const acct = await call('sc_fee_account', `'${TOF}',null,null`);
ok(num(acct.bill) === num(led.bill), 'sc_fee_account bill == ledger bill', { a: acct.bill, l: led.bill });
ok(num(acct.total_due) === num(led.total_due), 'sc_fee_account total_due == ledger total_due', { a: acct.total_due, l: led.total_due });
ok(num(acct.bill) !== 33100, 'the Fees page no longer reports the largest stale per-receipt snapshot (33,100)', { bill: acct.bill });

console.log('\n=== 4. no arrears row may cite a term the learner was never billed for ===');
const rows = led.arrears_rows || [];
ok(rows.length === 0, 'no prior-term rows are invented from an undated/unbilled calendar', rows);

console.log('\n=== 5. a learner with a REAL prior-term bill still shows arrears ===');
await db.exec(`
  insert into class_fee_structure(class,term,session,total,tuition,exam_fee,development,active)
    values ('SSS 2','Third Term','2025/2026',35100,27000,3000,5100,true);
  insert into fee_payments(student_id,student_name,amount_paid,fee_total,method,term,session,payment_date)
    values ('${LEK}','Afolabi Lekan',10000,35100,'cash','First Term','2026/2027','2026-10-31');
`);
await db.exec(`
  insert into class_fee_structure(class,term,session,total,tuition,exam_fee,development,active)
    values ('SSS 2','First Term','2026/2027',35100,27000,3000,5100,true);
`).catch(() => {});
// the school states, explicitly, that this learner was billed last term
await call('sc_fee_invoice_sync', `'${LEK}','Third Term','2025/2026',false`);
const lake = await call('sc_fee_ledger_for', `'${LEK}',null,null`);
console.log('   ledger →', JSON.stringify({ bill: lake.bill, paid: lake.paid, arrears: lake.arrears, total_due: lake.total_due }));
ok(num(lake.arrears) === 35100, 'the genuinely-billed last term (35,100, nothing paid) IS arrears', { arrears: lake.arrears });
ok(num(lake.bill) === 35100, 'and this term is billed separately at 35,100', { bill: lake.bill });
ok(num(lake.total_due) === 60200, 'total outstanding = 35,100 + 35,100 − 10,000 = 60,200', { total_due: lake.total_due });

console.log('\n=== 6. arrears are blank — not zero — when nothing is owed ===');
const blankCheck = await call('sc_fee_prior_terms', `'${TOF}'`);
ok(Array.isArray(blankCheck), 'sc_fee_prior_terms returns a list', blankCheck);
ok(blankCheck.length === 0, 'the list is empty for a learner with no prior bill', blankCheck);
const priorLek = await call('sc_fee_prior_terms', `'${LEK}'`);
ok(priorLek.length === 1 && num(priorLek[0].owing) === 35100, 'and names the one real prior-term debt', priorLek);

console.log('\n=== 7. every screen reads one engine — the Fees page rows ===');
const pageRows = await call('sc_fee_page_rows', `'JSS 3',null,null`);
ok(pageRows.length === 1, 'one JSS 3 learner', pageRows.length);
const pr = pageRows[0];
const l2 = await call('sc_fee_ledger_for', `'${TOF}',null,null`);
ok(num(pr.bill) === num(l2.bill), 'page row bill == ledger bill', { p: pr.bill, l: l2.bill });
ok(num(pr.paid) === num(l2.paid), 'page row paid == ledger paid');
ok(num(pr.total_due) === num(l2.total_due), 'page row total == ledger total');
ok(pr.has_arrears === false, 'page row says there are NO arrears (so the cell prints blank)');
ok(num(pr.arrears) === 0, 'and the arrears number is 0, not 36,100', pr.arrears);

console.log('\n=== 8. the compounded per-receipt snapshots are found and repaired ===');
// reproduce exactly what the screenshot shows: 23100 / 28100 / 33100
// reproduce the historical drift: write the compounded snapshots directly.
// the self-healing trigger now repairs them, so disable it for this one write
// to prove the migration ALSO works on a database that already has bad rows.
/* V12.69 — BOTH the statement trigger and the BEFORE trigger now heal these
   rows, so both must stand down for this one write, exactly as a legacy
   database would look before any fix ran. */
await db.exec(`alter table fee_payments disable trigger trg_fee_rows_autoheal_upd;
               alter table fee_payments disable trigger trg_compute_fee_payment_balance;`);
await db.exec(`update fee_payments set fee_total = 23100 where student_id='${TOF}' and payment_date='2026-10-10';
               update fee_payments set fee_total = 28100 where student_id='${TOF}' and payment_date='2026-10-25';
               update fee_payments set fee_total = 33100 where student_id='${TOF}' and payment_date='2026-11-04';`);
await db.exec(`alter table fee_payments enable trigger trg_fee_rows_autoheal_upd;
               alter table fee_payments enable trigger trg_compute_fee_payment_balance;`);
const before = await q(`select fee_total from fee_payments where student_id=$1 order by payment_date`, [TOF]);
const wrongCount = before.filter(x => Math.abs(num(x.fee_total) - 28100) > 0.005).length;
const dr = await call('sc_fee_truth_migrate', `true`);
ok(dr.would_fix === wrongCount && wrongCount > 0,
   `every receipt whose stored total is not the term bill is detected (${wrongCount})`, { found: dr.would_fix, wrongCount });
ok(dr.fixed === 0 && dr.dry_run === true, 'a dry run changes nothing', dr);
const still = await q(`select fee_total from fee_payments where student_id=$1 order by payment_date`, [TOF]);
ok(still.map(x => num(x.fee_total)).join(',') === before.map(x => num(x.fee_total)).join(','),
   'the rows are untouched after a dry run', still.map(x => x.fee_total));
const real = await call('sc_fee_truth_migrate', `false`);
ok(real.fixed === wrongCount, `the real run corrects all ${wrongCount}`, real.fixed);
const fixed = await q(`select fee_total from fee_payments where student_id=$1 order by payment_date`, [TOF]);
ok(fixed.every(x => num(x.fee_total) === 28100), 'every receipt now shows ONE term bill (28,100)', fixed.map(x => x.fee_total));
const again = await call('sc_fee_truth_migrate', `false`);
ok(again.fixed === 0, 'and it is idempotent', again.fixed);

console.log('\n=== 9. a receipt prints the term bill, never a running total ===');
const rcpts = await q(`select id from fee_payments where student_id=$1 order by payment_date`, [TOF]);
for (const r of rcpts) {
  const rb = await call('sc_fee_receipt_bill', `'${r.id}'`);
  ok(num(rb.bill) === 28100, 'receipt ' + String(r.id).slice(0, 8) + ' prints the bill 28,100', rb.bill);
}
const rb1 = await call('sc_fee_receipt_bill', `'${rcpts[0].id}'`);
ok(num(rb1.paid_this_receipt) === 10000, 'and its own amount', rb1.paid_this_receipt);
ok(num(rb1.balance_now) === 8100, 'and the balance as it stands today', rb1.balance_now);

console.log('\n=== 10. the doctor surfaces the fault it just repaired ===');
const doc = await call('sc_fee_doctor_v3', `null,true`);
const kinds = (doc.findings || []).map(x => x.kind);
ok(doc.ok === true, 'doctor runs');
ok(typeof doc.counts.compounded_receipt_total === 'number', 'it counts compounded receipt totals', doc.counts);

console.log('\n=== 11. raising invoices for a class is idempotent ===');
const a1 = await call('sc_fee_invoice_sync_all', `'JSS 3',null,null,false`);
ok(a1.ok === true, 'sync_all runs', a1);
ok(a1.prior_terms_included === false, 'and does NOT invent prior terms by default', a1.prior_terms_included);
const a2 = await call('sc_fee_invoice_sync_all', `'JSS 3',null,null,false`);
ok(a2.raised === a1.raised, 're-running raises the same set (upsert, not duplicate)', { a: a1.raised, b: a2.raised });
const invCount = await q(`select count(*)::int c from sc_fee_invoice where student_id=$1`, [TOF]);
ok(invCount[0].c === 1, 'one invoice, not many', invCount[0].c);

console.log('\n=== 12. allocation is oldest-first ===');
await call('sc_fee_invoice_sync', `'${LEK}','First Term','2026/2027',false`);
const alloc = await call('sc_fee_allocate', `'${LEK}',40000,null,null`);
ok(alloc.ok === true, 'allocate answers');
ok(num(alloc.allocated) === 40000, 'the full 40,000 is allocated', alloc.allocated);
ok((alloc.lines || [])[0].term === 'Third Term' || (alloc.lines || [])[0].session === '2025/2026',
   'the oldest debt is paid first', (alloc.lines || [])[0]);

console.log('\n=== 13. opening balances become invoices, not a guess ===');
await db.exec(`update students set opening_arrears = 5000, opening_arrears_note='2nd Term 2025/2026 balance' where id='${TOF}'`);
const oa = await call('sc_fee_opening_to_invoice', `true`);
ok(oa.count === 1, 'one opening balance found', oa.count);
const oaReal = await call('sc_fee_opening_to_invoice', `false`);
ok(oaReal.count === 1, 'converted', oaReal.count);
const l3 = await call('sc_fee_ledger_for', `'${TOF}',null,null`);
ok(num(l3.arrears) === 5000, 'the opening balance now appears as recorded arrears', l3.arrears);
ok(l3.has_arrears === true, 'and the has_arrears flag drives the UI', l3.has_arrears);

console.log('\n=== 14. THE ORIGINAL BUG CANNOT RECUR: a new payment cannot inflate the bill ===');
const beforeTotals = await q(`select fee_total from fee_payments where student_id=$1 order by payment_date`, [TOF]);
await db.exec(`insert into fee_payments(student_id,student_name,amount_paid,method,term,session,payment_date)
  values ('${TOF}','OLAYIWOLA TOFUNMI AJOKEADE',5000,'cash','First Term','2026/2027','2026-11-07')`);
const afterTotals = await q(`select fee_total from fee_payments where student_id=$1 order by payment_date`, [TOF]);
ok(afterTotals.every(x => Math.abs(num(x.fee_total) - 28100) < 0.005),
   'every receipt still says 28,100 after a fourth payment', afterTotals.map(x => x.fee_total));
ok(Math.max(...afterTotals.map(x => num(x.fee_total))) === 28100,
   'the bill did NOT grow (was 23,100→28,100→33,100 before)', afterTotals.map(x => x.fee_total));
const l4 = await call('sc_fee_ledger_for', `'${TOF}',null,null`);
ok(num(l4.paid) === 25000, 'paid is now 25,000', l4.paid);
ok(num(l4.bill) === 28100, 'the bill is still 28,100 — not 33,100', l4.bill);

console.log('\n=== 15. the dashboard and the Fees page still agree after the new payment ===');
const pageRows2 = await call('sc_fee_page_rows', `'JSS 3',null,null`);
const pr2 = pageRows2[0];
ok(num(pr2.bill) === num(l4.bill) && num(pr2.paid) === num(l4.paid) && num(pr2.total_due) === num(l4.total_due),
   'both readers return identical bill / paid / total', { page: [pr2.bill, pr2.paid, pr2.total_due], ledger: [l4.bill, l4.paid, l4.total_due] });

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
