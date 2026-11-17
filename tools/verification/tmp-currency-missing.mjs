/* V12.68 — "column \"currency\" does not exist" must be impossible.
   A school whose school_settings predates the column (or whose install was
   assembled from the historical pack sequence) hit exactly this on every fee
   RPC. This test reproduces it, then proves the complete schema heals it. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const H = new URL('.', import.meta.url).pathname;
const SQL = schemaText(H + '../../database/complete-schema.sql');
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('  PASS', m)) : (fail++, console.log('  FAIL', m, x ?? '')); };

const db = await PGlite.create();
await db.exec(fs.readFileSync(H + 'pglite-boot.sql', 'utf8'));
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
await db.exec(SQL);

const ADM = '11111111-1111-1111-1111-111111111111';
const S1 = 'aaaaaaaa-1111-1111-1111-111111111111';
await db.exec(`
  insert into auth.users(id,email) values('${ADM}','a@x.t') on conflict do nothing;
  insert into profiles(id,full_name,role,status) values('${ADM}','A','admin','approved') on conflict(id) do nothing;
  insert into students(id,full_name,class,status) values('${S1}','Afolabi Lekan','SS 2','active');
  insert into class_fee_structure(class,term,session,total,active) values('SS 2','First Term','2026/2027',35100,true);
  insert into academic_periods(session,term,starts_on,ends_on,is_current)
    values('2026/2027','First Term','2026-09-14','2026-12-11',true);
  select set_config('request.jwt.claim.sub','${ADM}',false);`);
/* remember the live symbol so the healing test can prove the VALUE survives */
const symBefore = (await db.query(`select currency from school_settings where id=1`)).rows[0].currency;

const call = async (fn, args) => {
  try { const r = (await db.query(`select public.${fn}(${args}) as r`)).rows[0].r;
        return { ok: true, v: typeof r === 'string' ? JSON.parse(r) : r }; }
  catch (e) { return { ok: false, err: e.message.split('\n')[0] }; }
};

console.log('\n=== 1. baseline: the column exists ===');
for (const fn of ['sc_student_fee_state', 'sc_fee_ledger_for', 'sc_fee_bill_v2', 'sc_fee_explain']) {
  const r = await call(fn, `'${S1}'` + (fn === 'sc_student_fee_state' ? '' : ',null,null'));
  ok(r.ok, `${fn} answers`, r.err);
}

console.log('\n=== 2. reproduce: a database whose school_settings has no currency ===');
await db.exec(`alter table public.school_settings drop column currency;`);
const broken = await call('sc_student_fee_state', `'${S1}'`);
/* the FIX is that it no longer throws. Prove the bill is still right. */
ok(broken.ok, 'the fee RPC still answers with the currency column GONE — it must not be able to throw', broken.err);
ok(broken.ok && Number(broken.v.bill) === 35100, 'and the bill is still 35,100', broken.v && broken.v.bill);
ok(broken.ok && String(broken.v.currency || '').length > 0, 'and the symbol falls back rather than failing', broken.v && broken.v.currency);

console.log('\n=== 3. the complete schema heals it (no other SQL) ===');
let healed = null;
try { await db.exec(SQL); } catch (e) { healed = e.message.split('\n')[0]; }
ok(!healed, 're-running complete-schema.sql does not error', healed);
const cols = (await db.query(`select column_name from information_schema.columns
                               where table_schema='public' and table_name='school_settings'
                                 and column_name='currency'`)).rows;
ok(cols.length === 1, 'the currency column is restored by the schema itself');
const symAfter = (await db.query(`select currency from school_settings where id=1`)).rows[0].currency;
ok(symBefore === symAfter, `and the school's own symbol is preserved (${symBefore})`, { symBefore, symAfter });

const after = await call('sc_student_fee_state', `'${S1}'`);
ok(after.ok, 'and the fee RPC answers again' + (after.err ? ': ' + after.err : ''), after.err);
ok(String(after.v.currency || '').length > 0, 'with a currency symbol', after.v && after.v.currency);
ok(Number(after.v.bill) === 35100, 'and the same bill (35,100)', after.v && after.v.bill);

console.log('\n=== 4. no fee function may reference school_settings.currency blindly ===');
const fns = (await db.query(`select p.proname, pg_get_functiondef(p.oid) def
                               from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                              where n.nspname='public'`)).rows;
const risky = fns.filter(f => /select\s+([a-z_]+\.)?currency\s+from\s+(public\.)?school_settings\s*(limit\s+1)?\s*\)/i.test(f.def)
                          && !/sc_school_currency/.test(f.def)).map(f => f.proname);
ok(risky.length === 0, 'every currency read goes through one guarded helper', risky);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await db.close();
process.exit(fail ? 1 : 0);
