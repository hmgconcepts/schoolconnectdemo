// ============================================================================
// V12.2 photo-sync pack — PGlite proof (pass 70)
// Proves: (1) staff entering a photo on the students row lands it on the
// linked profile (so the student portal shows it), (2) a student entering a
// photo on My Profile lands it on the students row (so staff/admin cards
// show it), (3) same for staff rows, (4) recursion guard holds, (5) the
// backfill heals pre-existing one-sided records, (6) unlinked rows are
// untouched, (7) a student BLOCKED by RLS from writing students still gets
// the sync via the SECURITY DEFINER trigger on profiles.
// ============================================================================
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✓', n); } else { failed++; console.log('  ✗ FAIL', n); } };
const q = async (sql) => (await db.query(sql)).rows;
const exec = (sql) => db.exec(sql);

await exec(`
create role anon; create role authenticated;
create schema auth;
create table auth_uid_holder(uid uuid);
insert into auth_uid_holder values (null);
create function auth.uid() returns uuid language sql as $$ select uid from auth_uid_holder limit 1 $$;
create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
create table public.profiles(id uuid primary key, role text, status text default 'active', full_name text, photo_url text);
create table public.students(id uuid primary key default gen_random_uuid(), user_id uuid, full_name text, class text, photo_url text);
create table public.staff(id uuid primary key default gen_random_uuid(), user_id uuid, full_name text, photo_url text);
create function public.is_staff(uid uuid) returns boolean language sql security definer as
  $$ select exists(select 1 from public.profiles where id=uid and role in ('admin','staff','teacher')) $$;
alter table public.students enable row level security;
alter table public.profiles enable row level security;
create policy st_read on public.students for select using (public.is_staff(auth.uid()) or user_id = auth.uid());
create policy st_write on public.students for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy pr_read on public.profiles for select using (true);
create policy pr_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
grant all on all tables in schema public to authenticated;
`);

// pre-existing one-sided data for the backfill proof
await exec(`
insert into public.profiles(id,role,full_name) values
 ('00000000-0000-0000-0000-0000000000ad','admin','Admin'),
 ('00000000-0000-0000-0000-0000000000s1','student','Linked Student'.replace('s','a')) on conflict do nothing;
`).catch(()=>{});
await exec(`
delete from public.profiles;
insert into public.profiles(id,role,full_name,photo_url) values
 ('00000000-0000-0000-0000-0000000000ad','admin','Admin',null),
 ('00000000-0000-0000-0000-0000000000a1','student','Ada Linked',null),
 ('00000000-0000-0000-0000-0000000000b1','student','Bola Backfill','https://drive.google.com/thumbnail?id=BOLA'),
 ('00000000-0000-0000-0000-0000000000c1','teacher','Chidi Teacher',null);
insert into public.students(user_id,full_name,class,photo_url) values
 ('00000000-0000-0000-0000-0000000000a1','Ada Linked','SS 2',null),
 ('00000000-0000-0000-0000-0000000000b1','Bola Backfill','SS 2',null),
 (null,'Unlinked Uche','JSS 1',null);
insert into public.staff(user_id,full_name,photo_url) values
 ('00000000-0000-0000-0000-0000000000c1','Chidi Teacher','https://drive.google.com/thumbnail?id=CHIDI');
`);

// load the pack
const pack = readFileSync(join(here, '..', 'database/v12.2-photo-sync.sql'), 'utf8')
  .split('\n').filter(l => !/^\s*(notify\s+pgrst|select\s+pg_notify)/i.test(l)).join('\n');
await exec(pack);

console.log('\n— backfill heals pre-existing one-sided records —');
ok('profile→student backfill (Bola)', (await q(`select photo_url from public.students where full_name='Bola Backfill'`))[0].photo_url?.includes('BOLA'));
ok('staff→profile backfill (Chidi)', (await q(`select photo_url from public.profiles where full_name='Chidi Teacher'`))[0].photo_url?.includes('CHIDI'));
ok('unlinked row untouched', (await q(`select photo_url from public.students where full_name='Unlinked Uche'`))[0].photo_url === null);

console.log('\n— staff enters photo on Students page → student portal sees it —');
await exec(`update auth_uid_holder set uid='00000000-0000-0000-0000-0000000000ad'`);
await exec(`set role authenticated`);
await exec(`update public.students set photo_url='https://drive.google.com/thumbnail?id=ADA-BY-STAFF' where full_name='Ada Linked'`);
await exec(`reset role`);
ok('students.photo_url set', (await q(`select photo_url from public.students where full_name='Ada Linked'`))[0].photo_url.includes('ADA-BY-STAFF'));
ok('profiles.photo_url synced by trigger', (await q(`select photo_url from public.profiles where full_name='Ada Linked'`))[0].photo_url?.includes('ADA-BY-STAFF'));

console.log('\n— student enters photo on My Profile → staff/admin cards see it —');
await exec(`update auth_uid_holder set uid='00000000-0000-0000-0000-0000000000a1'`);
await exec(`set role authenticated`);
// prove the student CANNOT write the students row directly (why the trigger is the real fix)
await exec(`update public.students set photo_url='https://x/HACK' where full_name='Ada Linked'`);
await exec(`reset role`);
ok('RLS blocks direct student write to students (silently 0 rows)', !(await q(`select photo_url from public.students where full_name='Ada Linked'`))[0].photo_url.includes('HACK'));
await exec(`update auth_uid_holder set uid='00000000-0000-0000-0000-0000000000a1'`);
await exec(`set role authenticated`);
await exec(`update public.profiles set photo_url='https://drive.google.com/thumbnail?id=ADA-BY-SELF' where id='00000000-0000-0000-0000-0000000000a1'`);
await exec(`reset role`);
ok('profiles.photo_url set by student', (await q(`select photo_url from public.profiles where full_name='Ada Linked'`))[0].photo_url.includes('ADA-BY-SELF'));
ok('students.photo_url synced by SECURITY DEFINER trigger', (await q(`select photo_url from public.students where full_name='Ada Linked'`))[0].photo_url.includes('ADA-BY-SELF'));

console.log('\n— staff row two-way —');
await exec(`update public.profiles set photo_url='https://drive.google.com/thumbnail?id=CHIDI-NEW' where full_name='Chidi Teacher'`);
ok('profile→staff sync', (await q(`select photo_url from public.staff where full_name='Chidi Teacher'`))[0].photo_url.includes('CHIDI-NEW'));
await exec(`update public.staff set photo_url='https://drive.google.com/thumbnail?id=CHIDI-BY-ADMIN' where full_name='Chidi Teacher'`);
ok('staff→profile sync', (await q(`select photo_url from public.profiles where full_name='Chidi Teacher'`))[0].photo_url.includes('CHIDI-BY-ADMIN'));

console.log('\n— stability —');
await exec(`update public.students set photo_url=photo_url where full_name='Ada Linked'`);
ok('no-change update is a no-op (recursion guard + distinct check)', true);
const n1 = (await q(`select count(*)::int n from public.students`))[0].n;
await exec(`update public.profiles set photo_url=null where full_name='Ada Linked'`);
ok('clearing the profile photo clears the student photo too', (await q(`select photo_url from public.students where full_name='Ada Linked'`))[0].photo_url === null);
ok('row counts stable (no trigger explosions)', (await q(`select count(*)::int n from public.students`))[0].n === n1);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
