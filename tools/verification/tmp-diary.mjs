import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const BOOT = HERE + 'pglite-boot.sql';
const S = p => schemaText(HERE + '../../database/' + p);

let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); c ? pass++ : fail++; };

const db = await PGlite.create();
await db.exec(fs.readFileSync(BOOT, 'utf8'));

// simulate a signed-in teacher: the boot stub returns null, so point it at a real profile
const UID = '11111111-1111-1111-1111-111111111111';
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${UID}'::uuid $$;`);

// ---------------------------------------------------------------- 1. full schema
let err = null;
try { await db.exec(S('complete-schema.sql')); } catch (e) { err = e; }
ok(!err, 'complete-schema.sql applies' + (err ? ': ' + err.message.slice(0, 250) : ''));
await db.exec(`insert into auth.users(id, email) values ('${UID}','obi@school.test') on conflict do nothing;
               insert into public.profiles(id, full_name, role) values ('${UID}','Mr Obi','teacher') on conflict (id) do nothing;`);

const before = await db.query(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`);

// ---------------------------------------------------------------- 2. diary pack
err = null;
try { await db.exec(S('v12.65-class-diary.sql')); } catch (e) { err = e; }
ok(!err, 'v12.65-class-diary.sql applies' + (err ? ': ' + err.message.slice(0, 250) : ''));
if (err) { console.log(`\n  ${pass} passed, ${fail} failed\n`); process.exit(1); }

// ---------------------------------------------------------------- 3. idempotent
err = null;
try { await db.exec(S('v12.65-class-diary.sql')); } catch (e) { err = e; }
ok(!err, 'v12.65 re-runs cleanly (idempotent)' + (err ? ': ' + err.message.slice(0, 250) : ''));

// ---------------------------------------------------------------- 4. objects
const tbl = await db.query(`select tablename from pg_tables where schemaname='public' and tablename in ('diary','diary_ack') order by 1`);
ok(tbl.rows.length === 2, 'both tables exist (diary, diary_ack)');
const fns = await db.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and proname in ('sc_diary_ack','sc_diary_acks','sc_diary_feed') order by 1`);
ok(fns.rows.length === 3, 'all three RPCs exist');
const pol = await db.query(`select policyname from pg_policies where schemaname='public' and tablename in ('diary','diary_ack')`);
ok(pol.rows.length >= 6, `RLS policies created (${pol.rows.length})`);
const rls = await db.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and relname in ('diary','diary_ack') order by 1`);
ok(rls.rows.every(r => r.relrowsecurity), 'RLS enabled on both tables');
const idx = await db.query(`select indexname from pg_indexes where schemaname='public' and tablename in ('diary','diary_ack')`);
ok(idx.rows.length >= 4, `indexes created (${idx.rows.length})`);

// ---------------------------------------------------------------- 5. the flow
// staff writes, family reads + acknowledges (run as service-side; RLS bypassed by postgres role)
const ins = await db.query(`insert into public.diary(date, class, subject, period, classwork, homework, behaviour, note, teacher_name)
  values (current_date, 'JSS 2', 'Mathematics', '2', 'Fractions worksheet 3', 'Ex. 4 nos 1-10', 'Good', 'Bring your ruler', 'Mr Obi')
  returning id`);
const did = ins.rows[0].id;
ok(!!did, 'a teacher can post an entry');

const ack = await db.query(`select public.sc_diary_ack($1,'seen') r`, [did]);
ok(ack.rows[0].r.ok === true, 'sc_diary_ack returns ok');
const again = await db.query(`select public.sc_diary_ack($1,'seen again') r`, [did]);
ok(again.rows[0].r.ok === true, 'sc_diary_ack is idempotent for the same user');

const acks = await db.query(`select * from public.sc_diary_acks($1)`, [did]);
ok(acks.rows.length === 1, `sc_diary_acks returns one row per user (${acks.rows.length})`);

const row = await db.query(`select acks from public.diary where id=$1`, [did]);
const arr = row.rows[0].acks;
ok(Array.isArray(arr) && arr.length === 1, `diary.acks jsonb stays in step (${Array.isArray(arr) ? arr.length : '?'} entries)`);

// ---------------------------------------------------------------- 6. cascade
await db.query(`delete from public.diary where id=$1`, [did]);
const orphan = await db.query(`select count(*)::int c from public.diary_ack where diary_id=$1`, [did]);
ok(orphan.rows[0].c === 0, 'deleting an entry cascades its acknowledgements');

// ---------------------------------------------------------------- 7. feed RPC exists & runs
const feed = await db.query(`select public.sc_diary_feed(null, 10) f`);
ok(Array.isArray(feed.rows[0].f), 'sc_diary_feed returns a json array');

// ---------------------------------------------------------------- 8. update trigger
const upd = await db.query(`insert into public.diary(class, classwork) values ('JSS 1','Test') returning id, updated_at`);
const id2 = upd.rows[0].id;
const t1 = upd.rows[0].updated_at;
await new Promise(r => setTimeout(r, 15));
await db.query(`update public.diary set classwork='Test 2' where id=$1`, [id2]);
const t2 = (await db.query(`select updated_at from public.diary where id=$1`, [id2])).rows[0].updated_at;
ok(new Date(t2) > new Date(t1), 'updated_at trigger fires on update');

// ------------------------------------------- 9. the pack is already folded into the complete schema
const after = await db.query(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`);
ok(after.rows[0].c === before.rows[0].c,
   `v12.65 is folded into complete-schema.sql (table count unchanged at ${after.rows[0].c} on re-apply)`);
const inComplete = await db.query(`select count(*)::int c from pg_tables where schemaname='public' and tablename in ('diary','diary_ack')`);
ok(inComplete.rows[0].c === 2, 'both diary tables are present straight from complete-schema.sql');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
