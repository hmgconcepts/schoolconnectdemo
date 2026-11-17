/* V12.69 — THE SCREENSHOT, REPRODUCED AND PROVEN FIXED.
   ------------------------------------------------------------------
   The school reported one learner, one term, two different balances:
       dashboard card  →  ₦8,100 outstanding
       Fees table row  →  ₦18,100 remaining balance
   and an opening arrears entry that never joined any total.

   This harness rebuilds that exact learner (bill 28,100; receipts 10,000 +
   5,000 + 5,000) and then asserts, on a real Postgres:

     1. blank opening arrears stays blank  (not 0, not null-as-zero)
     2. an opening arrears figure ADDS to the account total and NOT to the
        term bill  (the two must stay separate lines)
     3. the dashboard card and the table row print the SAME balance
     4. entering a payment reduces the one balance, and the arrears do not
        disappear when it does
     5. the opening balance is counted exactly once when it has also been
        converted to an invoice  (no double-counted receivable)
     6. the statement lines add up to the closing balance, for every learner
     7. term rollover raises the new term's bills, carries the debt by
        reference, and does not duplicate it
*/
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const H = new URL('.', import.meta.url).pathname;
const SQL = schemaText(H + '../../database/complete-schema.sql');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('  PASS', m)) : (fail++, console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x))); };

const db = await PGlite.create();
await db.exec(fs.readFileSync(H + 'pglite-boot.sql', 'utf8'));
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
await db.exec(SQL);

const ADM = '11111111-1111-1111-1111-111111111111';
const STU = 'aaaaaaaa-1111-1111-1111-111111111111';
const STU2 = 'aaaaaaaa-2222-2222-2222-222222222222';

await db.exec(`
  insert into auth.users(id,email) values('${ADM}','admin@x.t') on conflict do nothing;
  /* a signup trigger creates the profile as role=student/status=pending, so the
     seed must OVERWRITE it, not skip it */
  insert into profiles(id,full_name,role,status) values('${ADM}','Bursar','admin','approved')
    on conflict(id) do update set role='admin', status='approved';
  insert into students(id,full_name,class,status,admission_no)
    values('${STU}','OLAYIWOLA TOFUNMI AJOKEADE','JSS 3','active','GOSA/2026/0039');
  insert into students(id,full_name,class,status,admission_no)
    values('${STU2}','AFOLABI LEKAN','SS 2','active','GOSA/2026/0040');
  insert into class_fee_structure(class,term,session,total,active)
    values('JSS 3','First Term','2026/2027',28100,true),
          ('SS 2','First Term','2026/2027',35100,true);
  insert into academic_periods(session,term,starts_on,ends_on,is_current)
    values('2026/2027','First Term','2026-09-14','2026-12-11',true);
`);
/* the JWT must be set on the connection, in its own call, and it persists for
   the whole session — putting it in a multi-statement batch does not stick */
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ADM]);

const q = async (sql, p) => (await db.query(sql, p)).rows;
const rpc = async (fn, args) => {
  try {
    const r = (await db.query(`select public.${fn}(${args}) as r`)).rows[0].r;
    return typeof r === 'string' ? JSON.parse(r) : r;
  } catch (e) { return { ok: false, error: e.message.split('\n')[0] }; }
};
const money = n => Number(n || 0);

console.log('\n=== 1. the screenshot: bill 28,100 with three receipts ===');
await db.exec(`
  insert into fee_payments(student_id,student_name,fee_total,amount_paid,method,term,session,payment_date,reference)
  values('${STU}','OLAYIWOLA TOFUNMI AJOKEADE',28100,10000,'cash','First Term','2026/2027','2026-11-04','R1'),
        ('${STU}','OLAYIWOLA TOFUNMI AJOKEADE',28100, 5000,'cash','First Term','2026/2027','2026-10-26','R2'),
        ('${STU}','OLAYIWOLA TOFUNMI AJOKEADE',28100, 5000,'cash','First Term','2026/2027','2026-10-07','R3');
`);
let a = await rpc('sc_fee_account_for', `'${STU}'`);
ok(a.ok, 'the account answers', a.error);
ok(money(a.charges) === 28100, 'the term bill is 28,100', a.charges);
ok(money(a.paid) === 20000, 'every receipt counts: 20,000 paid', a.paid);
ok(money(a.closing) === 8100, 'outstanding is 8,100 — the card was right', a.closing);
ok(!a.has_opening, 'no opening balance, so the line is BLANK (has_opening=false)', a.opening_source);
ok(money(a.opening_balance) === 0, 'and its value is 0, not a phantom debt', a.opening_balance);

console.log('\n=== 2. the table row must agree with the card (the 18,100 bug) ===');
const rows = await rpc('sc_fee_page_rows', `null,null,null`);
const row = Array.isArray(rows) ? rows.find(r => r.student_id === STU) : null;
ok(!!row, 'the Fees table returns the learner');
ok(row && money(row.balance) === 8100,
   'the table row now prints 8,100 — the SAME number as the card (was 18,100)',
   row && { table: row.balance, card: a.closing });
ok(row && money(row.balance) === money(a.closing),
   'table row balance === account closing, by construction',
   { table: row && row.balance, card: a.closing });
ok(row && money(row.bill) === 28100, 'and the row still shows the term bill as 28,100', row && row.bill);

console.log('\n=== 3. the receipt snapshot columns tell one story ===');
await db.exec(`select public.sc_fee_sync_snapshots('${STU}', 'First Term', '2026/2027');`);
const snaps = await q(`select amount_paid, fee_total, balance from fee_payments
                        where student_id='${STU}' order by payment_date`);
ok(snaps.every(s => money(s.fee_total) === 28100),
   'every receipt stores the TERM BILL (28,100), not a running total',
   snaps.map(s => s.fee_total));
ok(money(snaps[snaps.length - 1].balance) === money(a.closing),
   'the LAST receipt\'s balance equals the account closing (8,100)',
   { last: snaps[snaps.length - 1].balance, closing: a.closing });
const balances = snaps.map(s => money(s.balance));
ok(balances[0] > balances[1] && balances[1] > balances[2],
   'and the running column decreases as receipts arrive (18,100 → 13,100 → 8,100)',
   balances);

console.log('\n=== 4. opening arrears: blank stays blank, entered ADDS ===');
await db.exec(`update students set opening_arrears = 0, opening_arrears_note = '' where id='${STU}';`);
a = await rpc('sc_fee_account_for', `'${STU}'`);
ok(money(a.opening_balance) === 0 && a.has_opening === false, 'zero opening → blank line', a.opening_source);

await db.exec(`update students set opening_arrears = 5000, opening_arrears_note='2nd Term 2025/2026 balance'
                where id='${STU}';`);
a = await rpc('sc_fee_account_for', `'${STU}'`);
ok(money(a.opening_balance) === 5000, 'the opening balance is now READ (was ignored entirely)', a.opening_balance);
ok(money(a.charges) === 28100, 'the TERM BILL is unchanged at 28,100 — arrears never inflate it', a.charges);
ok(money(a.closing) === 13100, 'outstanding = 8,100 + 5,000 = 13,100', a.closing);
ok(a.explain.some(l => l.line === 'Opening balance (before School Connect)' && money(l.amount) === 5000),
   'and the statement names it on its own line', a.explain.map(l => l.line));

console.log('\n=== 5. a payment reduces the ONE balance; arrears stay visible ===');
await db.exec(`insert into fee_payments(student_id,student_name,fee_total,amount_paid,method,term,session,payment_date,reference)
               values('${STU}','OLAYIWOLA TOFUNMI AJOKEADE',28100,3000,'cash','First Term','2026/2027','2026-11-10','R4');`);
a = await rpc('sc_fee_account_for', `'${STU}'`);
ok(money(a.paid) === 23000, '23,000 has now been received', a.paid);
ok(money(a.closing) === 10100, 'outstanding falls to 10,100 — the arrears did not absorb the payment', a.closing);
ok(money(a.opening_balance) === 5000, 'the opening line still reads 5,000', a.opening_balance);
const pr5 = await rpc('sc_fee_prove', `'${STU}'`);
ok(pr5.agrees === true, 'the statement lines still sum to the closing balance', pr5);
ok(pr5.opening_counted_once === 5000, 'and the opening balance is counted exactly once', pr5.opening_counted_once);

console.log('\n=== 6. the classic double-count: opening balance AND its invoice ===');
await db.exec(`insert into sc_fee_invoice(student_id,student_id_ref,class,term,session,
                                       amount,aid,net_amount,source,note)
               values('${STU}','GOSA/2026/0039','JSS 3','Opening balance','2nd Term 2025/2026 balance',
                      0,0,5000,'opening_balance','Carried over from the paper ledger');`);
a = await rpc('sc_fee_account_for', `'${STU}'`);
ok(money(a.opening_balance) === 5000,
   'counted ONCE at 5,000 — not 10,000, even though the column and the invoice both say 5,000',
   { opening: a.opening_balance, source: a.opening_source });
ok(a.opening_source === 'invoice', 'the invoice is authoritative and says so', a.opening_source);
ok(money(a.closing) === 10100, 'so the closing balance does not move', a.closing);
const prior = await rpc('sc_fee_prior_terms', `'${STU}'`);
ok(!Array.isArray(prior) || prior.every(p => p.opening !== true || p.term !== 'Opening balance'),
   'and it is not ALSO listed as a prior term', prior);

console.log('\n=== 7. a genuine earlier-term debt is still its own line ===');
await db.exec(`
  insert into sc_fee_invoice(student_id,student_id_ref,class,term,session,amount,aid,net_amount,source,note)
  values('${STU}','GOSA/2026/0039','JSS 3','Third Term','2025/2026',12000,0,12000,'structure','Billed, never paid');
`);
a = await rpc('sc_fee_account_for', `'${STU}'`);
ok(money(a.arrears) === 12000, 'earlier-term arrears read 12,000', a.arrears);
ok(a.has_arrears === true, 'and the flag says so (the UI must print a figure, not blank)', a.has_arrears);
ok(money(a.charges) === 28100, 'the term bill stays 28,100', a.charges);
ok(money(a.closing) === 22100, 'outstanding = 5,000 + 28,100 + 12,000 − 23,000 = 22,100', a.closing);

console.log('\n=== 8. every account reconciles with its own statement ===');
const self = await rpc('sc_fee_selfcheck', `null`);
ok(self.ok === true, 'the self-check runs', self.error);
ok(self.accounts_disagreeing_with_their_own_statement === 0,
   'no account disagrees with its own statement lines', self.disagreements);
ok(money(self.total_billed) - money(self.total_paid) === money(self.total_outstanding),
   `total billed − total paid = total outstanding (${self.total_billed} − ${self.total_paid} = ${self.total_outstanding})`,
   self);
ok(self.with_opening_balance === 1, 'exactly one learner carries an opening balance', self.with_opening_balance);

console.log('\n=== 9. rolling the school into a new term ===');
const dry = await rpc('sc_term_rollover', `'Second Term','2026/2027',true`);
ok(dry.ok, 'the rollover previews', dry.error);
ok(dry.dry_run === true, 'and it is a DRY RUN by default — nothing changed', dry.dry_run);
ok(dry.carried_owing_total >= 22100, 'it reports the debt that follows each learner', dry.carried_owing_total);
const beforeInv = money((await q(`select count(*) c from sc_fee_invoice`))[0].c);

await db.exec(`
  insert into class_fee_structure(class,term,session,total,active)
  values('JSS 3','Second Term','2026/2027',26400,true),
        ('SS 2','Second Term','2026/2027',33000,true);
`);
const live = await rpc('sc_term_rollover', `'Second Term','2026/2027',false`);
ok(live.ok, 'the rollover applies', live.error);
ok(live.invoices_to_raise === 2, 'one invoice per active learner (2)', live.invoices_to_raise);
const afterInv = money((await q(`select count(*) c from sc_fee_invoice`))[0].c);
/* the roll does two things: it RECORDS the outgoing term's unpaid bill (so the
   debt survives the date change) and RAISES the new term's bill. Two learners
   × two jobs — but only for those who actually owe, so assert what matters:
   the new term's bill exists for every learner and nothing was billed twice. */
const newInv = await q(`select student_id, net_amount from sc_fee_invoice
                         where term='Second Term' and session='2026/2027'`);
ok(newInv.length === 2, 'every active learner got a Second Term bill', newInv);
ok(newInv.every(i => money(i.net_amount) === 26400 || money(i.net_amount) === 33000),
   'each new bill comes from that class\'s published structure', newInv);
ok(afterInv > beforeInv, `invoices were created (${beforeInv} → ${afterInv})`, { beforeInv, afterInv });
const dupes = await q(`select student_id, count(*) c from sc_fee_invoice
                        where lower(btrim(term))='second term' and lower(btrim(session))='2026/2027'
                        group by student_id having count(*) > 1`);
ok(dupes.length === 0, 'and nobody was billed twice for the new term', dupes);

const cur = await q(`select term, session from academic_periods where is_current = true`);
ok(cur.length === 1, 'exactly ONE period is current — never two', cur);
ok(cur[0].term === 'Second Term', 'and it is the new term', cur[0]);

const a2 = await rpc('sc_fee_account_for', `'${STU}', 'Second Term', '2026/2027'`);
ok(money(a2.charges) === 26400, 'the new term bills 26,400 from the published structure', a2.charges);
/* The learner owed 22,100 at the end of First Term, made of three distinct
   debts. Only the two TERM debts become arrears; the 5,000 opening balance
   stays on its own opening line for ever (that is the point of R2). So:
       arrears (17,100) + opening (5,000) === the old 22,100 closing balance,
   and that is the invariant that proves nothing was lost or doubled. */
ok(money(a2.arrears) + money(a2.opening_balance) === money(a.closing),
   'and the whole unpaid balance follows — arrears + opening = the old closing',
   { arrears: a2.arrears, opening: a2.opening_balance, was_closing: a.closing });
ok(money(a2.arrears) === 17100,
   'the two TEARLY debts are arrears (17,100); the opening 5,000 keeps its own line',
   { arrears: a2.arrears });
ok(money(a2.total_billed) === money(a2.charges) + money(a2.arrears) + money(a2.opening_balance),
   'the new term\'s total billed = opening + new charges + arrears, each counted once',
   { total: a2.total_billed, charges: a2.charges, arrears: a2.arrears, opening: a2.opening_balance });
const debtAfter = money(a2.closing);
/* V12.69 — subtract receipts filed under THIS term, not every receipt on the
   account. `paid` reports all money received; the earlier-terms figure is
   already net of the receipts that settled those terms, so subtracting `paid`
   here would take those payments off twice. That double count is what this
   assertion used to encode — the engine was right and the test was wrong. */
ok(debtAfter === money(a2.charges) + money(a2.arrears) + money(a2.opening_balance) - money(a2.paid_this_term),
   'the new closing balance is arithmetically identical to its parts',
   { closing: a2.closing, charges: a2.charges, arrears: a2.arrears,
     opening: a2.opening_balance, paid_this_term: a2.paid_this_term, paid_all: a2.paid });
ok(money(a2.paid) === 23000 && money(a2.paid_this_term) === 0,
   'paid still reports every receipt (23,000) while nothing is filed under the new term yet',
   { paid: a2.paid, paid_this_term: a2.paid_this_term });

console.log('\n=== 10. a past term reads as history, not as the future ===');
const a1 = await rpc('sc_fee_account_for', `'${STU}', 'First Term', '2026/2027'`);
ok(a1.ok === true, 'the past term still answers', a1.error);
ok(money(a1.charges) === 28100, 'First Term still bills 28,100', a1.charges);
ok(money(a1.paid) === 23000, 'and still shows the 23,000 received against it', a1.paid);
/* First Term's own position: 5,000 opening + 28,100 bill + 12,000 Third Term
   − 23,000 paid = 22,100. The 12,000 IS an earlier debt, so it belongs here. */
ok(money(a1.closing) === 22100,
   'and its closing balance is the position AT THE END of First Term (22,100)',
   { closing: a1.closing, opening: a1.opening_balance, arrears: a1.arrears });
/* the bug this replaces: reading a past term listed the LATER term's bill as
   arrears, so a historical statement showed a debt that did not exist yet */
/* the bug this replaces: reading a past term listed the LATER Second Term bill
   (26,400) as arrears, which never existed at that point in time */
ok(money(a1.arrears) === 12000,
   'its arrears are only the genuinely earlier Third Term (12,000) — not Second Term',
   { arrears: a1.arrears });
ok(money(a1.opening_balance) === 5000, 'its opening line is still 5,000', a1.opening_balance);
const ord = await q(`select public.sc_term_ordinal('First Term','2026/2027') a,
                            public.sc_term_ordinal('Second Term','2026/2027') b,
                            public.sc_term_ordinal('Third Term','2025/2026') c`);
ok(money(ord[0].a) < money(ord[0].b) && money(ord[0].c) < money(ord[0].a),
   'the one term ordering puts First < Second and 2025/2026 Third before 2026/2027 First',
   ord[0]);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await db.close();
process.exit(fail ? 1 : 0);
