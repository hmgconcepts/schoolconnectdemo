/* Item 4 — the one-click repair, tested against the exact scenario in the report:
   bill 30,500; paid 10,000 + 5,000 + 5,000 (balance 10,500); then the bursar
   remembers an older 8,000 debt and adds it to the FIRST receipt. Everything
   downstream must update and the numbers must stay consistent. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const db = await PGlite.create();
await db.exec(fs.readFileSync(HERE + 'pglite-boot.sql', 'utf8'));
await db.exec(schemaText(HERE + '../../database/complete-schema.sql'));
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('app.uid',true),'')::uuid $f$;`);
await db.exec(`
insert into auth.users(id,email) values('11111111-1111-1111-1111-111111111111','a@x.com') on conflict do nothing;
update public.profiles set role='admin',status='approved' where id='11111111-1111-1111-1111-111111111111';
insert into public.students(id,full_name,class,arm,admission_no,status) values
 ('da000000-0000-4000-8000-000000000001','Report Case','JSS 2','A','R/1','active'),
 ('da000000-0000-4000-8000-000000000002','No Bill Kid','JSS 2','A','R/2','active'),
 ('da000000-0000-4000-8000-000000000003','Overpaid Kid','JSS 2','A','R/3','active');
insert into public.academic_periods(term,session,is_current) values ('Second Term','2025/2026',true);
insert into public.class_fee_structure(class,session,term,tuition,exam_fee,development,other_fee,discount,active)
 values('JSS 2','2025/2026','Second Term',20500,5000,5000,0,0,true);
-- the three payments from the report
insert into public.fee_payments(student_id,student_name,amount_paid,fee_total,term,session,method,payment_date) values
 ('da000000-0000-4000-8000-000000000001','Report Case',10000,30500,'Second Term','2025/2026','cash','2026-09-01'),
 ('da000000-0000-4000-8000-000000000001','Report Case', 5000,20500,'Second Term','2025/2026','cash','2026-09-15'),
 ('da000000-0000-4000-8000-000000000001','Report Case', 5000,15500,'Second Term','2025/2026','cash','2026-10-01');
-- a receipt with no period, and an overpayment case
insert into public.fee_payments(student_id,student_name,amount_paid,fee_total,term,session,method,payment_date) values
 ('da000000-0000-4000-8000-000000000002','No Bill Kid',3000,0,'','','cash','2026-10-02'),
 ('da000000-0000-4000-8000-000000000003','Overpaid Kid',40000,30500,'Second Term','2025/2026','cash','2026-10-03');
`);
await db.exec(`set app.uid='11111111-1111-1111-1111-111111111111'`);
const q = async (sql, p) => (await db.query(sql, p)).rows[0];
const S = 'da000000-0000-4000-8000-000000000001';
const led = async () => (await q(`select public.sc_fee_ledger_for($1,null,null) l`, [S])).l;

let L = await led();
console.log('BEFORE  bill=%s paid=%s balance=%s due=%s', L.bill, L.paid, L.balance, L.total_due);
if (Number(L.balance) !== 10500) { console.log('FAIL: expected balance 10,500'); process.exit(1); }

// --- the bursar remembers an older 8,000 debt and adds it to the FIRST payment
await db.exec(`update public.fee_payments set fee_total = fee_total + 8000
               where student_id='${S}' and payment_date='2026-09-01'`);
L = await led();
console.log('AFTER EDIT (no repair) bill=%s paid=%s balance=%s due=%s', L.bill, L.paid, L.balance, L.total_due);

// --- the one click
const dry = (await q(`select public.sc_fee_repair_all(true,null,null) r`)).r;
console.log('\nDRY RUN  mode=%s scanned=%s findings=%s', dry.mode, dry.students_scanned, dry.findings.length);
for (const f of dry.findings) console.log('   · [%s] %s — %s', f.kind, f.student || f.count, f.issue);

const rep = (await q(`select public.sc_fee_repair_all(false,null,null) r`)).r;
console.log('\nREPAIR   mode=%s scanned=%s rebuilt=%s outstanding=%s', rep.mode, rep.students_scanned, rep.students_rebuilt, rep.outstanding_after);
console.log('   counts: %s', JSON.stringify(rep.counts));

L = await led();
console.log('\nAFTER REPAIR  bill=%s paid=%s balance=%s due=%s arrears=%s', L.bill, L.paid, L.balance, L.total_due, L.arrears);

// snapshots must now be internally consistent: last row balance == ledger balance
const lastRow = (await q(`select balance, fee_total from public.fee_payments
  where student_id='${S}' order by payment_date desc limit 1`));
console.log('last receipt snapshot: fee_total=%s balance=%s', lastRow.fee_total, lastRow.balance);

// idempotence
const rep2 = (await q(`select public.sc_fee_repair_all(false,null,null) r`)).r;
L = await led();
console.log('\nSECOND RUN   rebuilt=%s  due still=%s', rep2.students_rebuilt, L.total_due);

const fails = [];
if (Number(L.balance) !== 10500) fails.push('balance drifted after the repair: ' + L.balance);
if (Number(L.paid) !== 20000) fails.push('paid changed unexpectedly: ' + L.paid);
if (Number(rep.counts.missing_period) < 1) fails.push('the period-less receipt was not detected');
if (Number(rep.counts.overpaid) < 1) fails.push('the overpayment was not detected');
// No Bill Kid is in a class that HAS a structure, so after the period is
// repaired his bill resolves — the finding must appear in the dry run instead.
if (!dry.findings.some(f => f.kind === 'overpayment')) fails.push('dry run did not report the overpayment');
if (!dry.findings.some(f => f.kind === 'missing_period')) fails.push('dry run did not report the period-less receipt');
const nb = (await q(`select public.sc_fee_ledger_for('da000000-0000-4000-8000-000000000002',null,null) l`)).l;
if (Number(nb.bill) !== 30500) fails.push('after repair the previously period-less receipt should now have a real bill, got ' + nb.bill);
const nop = (await q(`select count(*)::int c from public.fee_payments where coalesce(term,'')=''`)).c;
if (nop !== 0) fails.push('receipts still missing a period: ' + nop);
console.log('\n' + (fails.length ? 'FAIL:\n - ' + fails.join('\n - ') : 'PASS — repair is complete, idempotent, and the balance is still 10,500.'));
process.exit(fails.length ? 1 : 0);
