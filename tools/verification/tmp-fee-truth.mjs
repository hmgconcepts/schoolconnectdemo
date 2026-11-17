import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const S = p => schemaText(HERE + '../../database/' + p);

let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); c ? pass++ : fail++; };
const n = v => Number(v || 0);
const eq = (a, b) => Math.abs(n(a) - n(b)) < 0.005;

const db = await PGlite.create();
await db.exec(fs.readFileSync(HERE + 'pglite-boot.sql', 'utf8'));
const UID = '11111111-1111-1111-1111-111111111111';
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${UID}'::uuid $$;`);
await db.exec(S('complete-schema.sql'));
await db.exec(S('v12.66-one-truth-and-remap.sql'));
await db.exec(`
  insert into auth.users(id,email) values ('${UID}','bursar@school.test') on conflict do nothing;
  insert into profiles(id,full_name,role,status) values ('${UID}','Bursar','admin','approved')
    on conflict (id) do update set role='admin', status='approved';
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

// ======================================================= THE SCREENSHOT, REPRODUCED
console.log('\n=== 1. the figures from the screenshots ===');
// OLAYIWOLA TOFUNMI AJOKEADE · JSS 3 · First Term 2026/2027
// dashboard: bill 28,100 · paid 20,000 · balance 8,100 · arrears 3,000 · total 11,100
await db.exec(`
  insert into academic_periods(term,session,is_current) values ('First Term','2026/2027',true)
    on conflict do nothing;
  insert into students(id,full_name,admission_no,class,status,opening_arrears,opening_arrears_note)
    values ('33333333-3333-3333-3333-333333333333','OLAYIWOLA TOFUNMI AJOKEADE','GoSA/2026/001','JSS 3','active',3000,'Before School Connect')
    on conflict (id) do nothing;
  /* the bursar's personal total for this learner */
  insert into fee_payments(student_id,student_name,amount_paid,payment_date,method,term,session,
                           fee_total,total_overridden,reference)
    values ('33333333-3333-3333-3333-333333333333','OLAYIWOLA TOFUNMI AJOKEADE',10000,
            '2026-11-04','cash','First Term','2026/2027',28100,true,'R1'),
           ('33333333-3333-3333-3333-333333333333','OLAYIWOLA TOFUNMI AJOKEADE',5000,
            '2026-10-26','cash','First Term','2026/2027',28100,true,'R2'),
           ('33333333-3333-3333-3333-333333333333','OLAYIWOLA TOFUNMI AJOKEADE',5000,
            '2026-10-07','cash','First Term','2026/2027',28100,true,'R3');
`);
const SID = '33333333-3333-3333-3333-333333333333';
let led = (await q(`select public.sc_fee_ledger_for('${SID}',null,null) l`))[0].l;
ok(eq(led.bill, 28100), `bill = ${n(led.bill).toLocaleString()} (expected 28,100)`);
ok(eq(led.paid, 20000), `paid = ${n(led.paid).toLocaleString()} (expected 20,000)`);
ok(eq(led.balance, 8100), `balance this term = ${n(led.balance).toLocaleString()} (expected 8,100)`);
ok(eq(led.arrears, 3000), `arrears = ${n(led.arrears).toLocaleString()} (expected 3,000)`);
ok(eq(led.total_due, 11100), `TOTAL OUTSTANDING = ${n(led.total_due).toLocaleString()} (expected 11,100)`);
ok(led.override === true, 'the bursar override is reported, not hidden');

// the fatal old failure: every receipt carried fee_total = 28,100 and V12.61's
// pre-fix aggregations used max() per term; prove it is not multiplied
ok(eq(led.total_due, 11100), 'the overridden total is NOT multiplied by the number of receipts');

console.log('\n=== 2. all four readers return identical figures ===');
const acct = (await q(`select public.sc_fee_account('${SID}',null,null) a`))[0].a;
const fam  = (await q(`select public.sc_student_fee_state('${SID}') a`))[0].a;
for (const k of ['bill', 'paid', 'balance', 'arrears', 'total_due']) {
  ok(eq(acct[k], led[k]) && eq(fam[k], led[k]), `${k}: ledger=${n(led[k])} account=${n(acct[k])} family=${n(fam[k])}`);
}
const rec = (await q(`select public.sc_fee_reconcile('${SID}') r`))[0].r;
ok(rec.clean === true, `sc_fee_reconcile says clean (mismatches=${rec.mismatches})`);

console.log('\n=== 3. the arithmetic closes ===');
const ex = led.explain;
const sumLines = ex.slice(0, 3).reduce((a, x) => a + n(x.amount), 0);
ok(eq(sumLines, led.total_due), `bill + arrears − paid = ${n(sumLines)} = TOTAL OUTSTANDING ${n(led.total_due)}`);
ok(ex.length === 4 && /BALANCE STILL OWED/.test(ex[3].line), 'the explain block ends on the balance line');

// ======================================================= THE 13,100 vs 11,100 DEFECT
console.log('\n=== 4. THE REPORTED DEFECT: 13,100 on one page, 11,100 on another ===');
// the old Fees page rebuilt the balance from the LAST receipt's own fee_total
// snapshot plus the opening balance, "forgetting" the override was already
// net of every earlier payment. Prove the single engine cannot produce that.
const receipts = await q(`select amount_paid, fee_total from fee_payments where student_id='${SID}' order by payment_date`);
const oldStyle = receipts.slice(-1).reduce((a, r) => a + n(r.fee_total), 0) + 3000 - n(receipts[0].amount_paid);
ok(!eq(oldStyle, led.total_due), `the old per-receipt rebuild yields ${n(oldStyle).toLocaleString()} — different from the engine's ${n(led.total_due).toLocaleString()}`);
ok(eq(led.total_due, 11100), 'the engine reports one figure and every page prints it');

console.log('\n=== 5. a term with NO fee structure is NOT a zero bill ===');
await db.exec(`
  insert into students(id,full_name,admission_no,class,status)
    values ('44444444-4444-4444-4444-444444444444','Chidi No Structure','GoSA/2026/002','JSS 1','active')
    on conflict (id) do nothing;
  insert into fee_payments(student_id,student_name,amount_paid,payment_date,method,term,session)
    values ('44444444-4444-4444-4444-444444444444','Chidi No Structure',5000,
            '2026-10-01','cash','First Term','2026/2027');
`);
let c2 = (await q(`select public.sc_fee_ledger_for('44444444-4444-4444-4444-444444444444',null,null) l`))[0].l;
ok(c2.bill_known === false, `bill_known = ${c2.bill_known} (no structure published)`);
ok(c2.match_status === 'no_structure', `match_status = ${c2.match_status}`);
ok(/No fee structure/i.test(c2.match_note), 'the note says so in words');
ok(c2.checks.some(x => x.check === 'bill_unknown'), 'the ledger raises a bill_unknown check for the bursar');
ok(c2.status === 'unbilled', `status = ${c2.status} (not 'paid', not 'no-bill')`);

console.log('\n=== 6. arrears found WITHOUT a receipt (the silent-loss bug) ===');
await db.exec(`
  /* an earlier term the learner never paid in -> no receipt, therefore the old
     engine produced no arrears at all */
  insert into class_fee_structure(class,term,session,total,active)
    values ('JSS 1','Third Term','2025/2026',15000,true) on conflict do nothing;
  insert into academic_periods(term,session,is_current,starts_on,ends_on)
    values ('Third Term','2025/2026',false,'2025-04-20','2025-07-20')
    on conflict do nothing;
  update students set created_at = '2025-01-10' where id='44444444-4444-4444-4444-444444444444';
`);
c2 = (await q(`select public.sc_fee_ledger_for('44444444-4444-4444-4444-444444444444',null,null) l`))[0].l;
const thirdTerm = (c2.arrears_rows || []).find(r => /Third Term/.test(r.term || ''));
ok(!!thirdTerm, 'the unpaid earlier term now APPEARS in arrears');
ok(thirdTerm && eq(thirdTerm.owing, 15000), `arrears row owes ${thirdTerm ? n(thirdTerm.owing).toLocaleString() : '—'} (15,000)`);
ok(eq(c2.arrears, 15000), `total arrears = ${n(c2.arrears).toLocaleString()}`);

console.log('\n=== 7. opening balance is never counted twice ===');
await db.exec(`
  insert into students(id,full_name,admission_no,class,status,opening_arrears)
    values ('55555555-5555-5555-5555-555555555555','Bola Double','GoSA/2026/003','JSS 2','active',4000)
    on conflict (id) do nothing;
  /* the bursar ALSO recorded it as a receipt -> must not be added twice */
  insert into fee_payments(student_id,student_name,amount_paid,payment_date,method,term,session)
    values ('55555555-5555-5555-5555-555555555555','Bola Double',4000,
            '2026-09-15','opening balance','First Term','2026/2027');
`);
const b = (await q(`select public.sc_fee_ledger_for('55555555-5555-5555-5555-555555555555',null,null) l`))[0].l;
ok(eq(b.opening_arrears, 0), `opening_arrears suppressed to ${n(b.opening_arrears)} (the receipt already carries it)`);
ok(b.checks.some(x => x.check === 'opening_balance_double_count'), 'and the check is reported to the bursar');

console.log('\n=== 8. the doctor sees what the old one could not ===');
const doc = (await q(`select public.sc_fee_doctor_v2(null,null,true) d`))[0].d;
ok(doc.ok === true, 'doctor ran (dry run)');
ok(doc.counts.bill_unknown >= 1, `bill_unknown = ${doc.counts.bill_unknown}`);
ok(doc.counts.duplicate_groups === 0, `no false duplicate alarm (${doc.counts.duplicate_groups})`);
ok(doc.counts.missing_period === 0, `no false missing-period alarm (${doc.counts.missing_period})`);
ok(Array.isArray(doc.findings) && doc.findings.length > 0, `findings returned (${doc.findings.length})`);
const kinds = doc.findings.map(x => x.kind);
ok(kinds.includes('bill_unknown'), 'names bill_unknown explicitly');
ok(kinds.includes('bill_unknown_detail'), 'and lists the affected learners');

// a receipt with no term IS invisible -> the doctor must find and fix it
await db.exec(`
  insert into fee_payments(student_id,student_name,amount_paid,payment_date,method,term,session)
    values ('33333333-3333-3333-3333-333333333333','OLAYIWOLA TOFUNMI AJOKEADE',2500,
            '2026-11-08','cash','','');
`);
const doc2 = (await q(`select public.sc_fee_doctor_v2(null,null,true) d`))[0].d;
ok(doc2.counts.missing_period === 1, `doctor finds the un-termed receipt (${doc2.counts.missing_period})`);
let before = (await q(`select public.sc_fee_ledger_for('${SID}',null,null) l`))[0].l;
ok(eq(before.paid, 20000), `that receipt is currently invisible to the balance (paid=${n(before.paid)})`);
const doc3 = (await q(`select public.sc_fee_doctor_v2(null,null,false) d`))[0].d;
ok(doc3.fixed.missing_period === 1, `doctor fixed it (${doc3.fixed.missing_period})`);
let after = (await q(`select public.sc_fee_ledger_for('${SID}',null,null) l`))[0].l;
ok(eq(after.paid, 22500), `the money is now counted (paid=${n(after.paid).toLocaleString()})`);
ok(eq(after.total_due, 8600), `and the balance corrected to ${n(after.total_due).toLocaleString()}`);

console.log('\n=== 9. the truth sheet ===');
const ts = (await q(`select public.sc_fee_truth_sheet('${SID}') t`))[0].t;
ok(ts.ok === true, 'truth sheet loads');
ok(ts.receipts.length === 4, `lists every receipt (${ts.receipts.length})`);
ok(ts.receipts.filter(r => r.for_this_term).length === 4, 'marks which receipts count for this term');
ok(ts.arithmetic.length === 4, 'carries the printable arithmetic');
ok(eq(ts.headline.total_outstanding, after.total_due), 'headline matches the engine');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
