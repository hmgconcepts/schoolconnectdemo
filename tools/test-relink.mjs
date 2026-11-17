// ============================================================================
// V12.6 one-click relink — PGlite proof (pass 80)
// Proves: profiles.admission_no/staff_no columns, auto-link trigger on
// profile creation, and bulk sc_relink_all() RPC linking staff by staff_no
// and email, students by admission_no.
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
create table public.profiles(id uuid primary key, email text, full_name text, role text, status text default 'active', admission_no text, staff_no text, photo_url text);
create table public.students(id uuid primary key default gen_random_uuid(), admission_no text unique, full_name text, class text, user_id uuid, photo_url text);
create table public.staff(id uuid primary key default gen_random_uuid(), staff_no text unique, full_name text, email text, user_id uuid, photo_url text);
create function public.is_admin(uid uuid) returns boolean language sql as $$ select exists(select 1 from public.profiles where id=uid and role in ('admin','super_admin')) $$;
alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.staff enable row level security;
create policy pr_all on public.profiles for all using (true) with check (true);
create policy st_all on public.students for all using (true) with check (true);
create policy sf_all on public.staff for all using (true) with check (true);
grant all on all tables in schema public to authenticated;
create table public.sc_install_state(key text primary key, applied_at timestamptz default now(), details jsonb default '{}'::jsonb);
alter table public.sc_install_state enable row level security;
create policy sis_all on public.sc_install_state for all using (true) with check (true);
`);

const pack = readFileSync(join(here, '..', 'database/v12.6-relink.sql'), 'utf8')
  .split('\n').filter(l => !/^\s*(notify\s+pgrst|select\s+pg_notify)/i.test(l)).join('\n');
await exec(pack);

console.log('\n— linking columns exist —');
const cols = await q(`select table_name, column_name from information_schema.columns where table_schema='public' and table_name in ('profiles') and column_name in ('admission_no','staff_no')`);
ok('profiles.admission_no + staff_no columns', cols.length === 2);

console.log('\n— auto-link trigger on profile insert —');
await exec(`
insert into public.students(admission_no, full_name, class) values ('SCD/2024/001','Ada Student','SS 2'),('SCD/2024/002','Bola Student','SS 2');
insert into public.staff(staff_no, full_name, email) values ('STF/2024/001','Chidi Teacher','chidi@school.com'),('STF/2024/002','Funke Teacher','funke@school.com');
`);
await exec(`insert into public.profiles(id,email,full_name,role,admission_no) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','ada@school.com','Ada Student','student','SCD/2024/001')`);
ok('student auto-linked by admission_no on profile insert', (await q(`select user_id from public.students where admission_no='SCD/2024/001'`))[0].user_id === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');

await exec(`insert into public.profiles(id,email,full_name,role,staff_no) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','chidi@school.com','Chidi Teacher','teacher','STF/2024/001')`);
ok('staff auto-linked by staff_no', (await q(`select user_id from public.staff where staff_no='STF/2024/001'`))[0].user_id === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');

await exec(`insert into public.profiles(id,email,full_name,role) values ('cccccccc-cccc-cccc-cccc-ccccccccccc1','funke@school.com','Funke Teacher','teacher')`);
ok('staff auto-linked by email fallback', (await q(`select user_id from public.staff where staff_no='STF/2024/002'`))[0].user_id === 'cccccccc-cccc-cccc-cccc-ccccccccccc1');

console.log('\n— bulk sc_relink_all() —');
// reset links, create new profiles without trigger? Disable trigger temporarily for bulk test
await exec(`drop trigger trg_profiles_auto_link on public.profiles`);
await exec(`update public.students set user_id=null; update public.staff set user_id=null;`);
await exec(`delete from public.profiles where id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','cccccccc-cccc-cccc-cccc-ccccccccccc1')`);
await exec(`
insert into public.profiles(id,email,full_name,role,admission_no,staff_no,status) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','ada@school.com','Ada Student','student','SCD/2024/001',null,'approved'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','chidi@school.com','Chidi Teacher','teacher',null,'STF/2024/001','approved'),
 ('cccccccc-cccc-cccc-cccc-ccccccccccc1','funke@school.com','Funke Teacher','teacher',null,null,'approved'),
 ('dddddddd-dddd-dddd-dddd-dddddddddddd','admin@school.com','Admin','admin',null,null,'approved');
`);
await exec(`update auth_uid_holder set uid='dddddddd-dddd-dddd-dddd-dddddddddddd'`);
const res = (await q(`select public.sc_relink_all() r`))[0].r;
console.log('  bulk result:', JSON.stringify(res));
ok('bulk linked 1 student via admission_no', res.linked_students === 1);
ok('bulk linked 2 staff via staff_no + email', res.linked_staff === 2);
ok('missed counts correct (1 student still pending)', res.missed_students === 1 && res.missed_staff === 0);

// idempotence
const res2 = (await q(`select public.sc_relink_all() r`))[0].r;
ok('bulk idempotent (second run links 0)', res2.linked_students === 0 && res2.linked_staff === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
