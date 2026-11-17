// V12.5 schema-doctor proof: retro-markers detect real artifacts truthfully,
// the reader RPC is staff-gated, and re-running is idempotent.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✓', n); } else { failed++; console.log('  ✗ FAIL', n); } };
const q = async (sql) => (await db.query(sql)).rows;

await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth_uid_holder(uid uuid);
insert into auth_uid_holder values (null);
create function auth.uid() returns uuid language sql as $$ select uid from auth_uid_holder limit 1 $$;
create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
create table public.profiles(id uuid primary key, role text, status text default 'active');
create function public.is_staff(uid uuid) returns boolean language sql security definer as
  $$ select exists(select 1 from public.profiles where id=uid and role in ('admin','staff','teacher')) $$;
create table public.sc_install_state(key text primary key, applied_at timestamptz not null default now(), details jsonb default '{}'::jsonb);
alter table public.sc_install_state enable row level security;
-- simulate a database that ALREADY has some pack artifacts (ran packs pre-markers):
create table public.students(id uuid primary key default gen_random_uuid(), portal_locked boolean default false, admission_year int, photo_url text, user_id uuid);
create table public.staff(id uuid primary key default gen_random_uuid(), date_of_birth date, photo_url text, user_id uuid);
create table public.attendance_checkins(id uuid primary key default gen_random_uuid(), status text);
create function public.sc_poll_results(p_poll uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.sc_sync_photo_to_profile() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_students_photo_sync after update on public.students for each row execute function public.sc_sync_photo_to_profile();
grant all on all tables in schema public to authenticated;
`).catch(e => { console.log('setup note:', e.message); });
await db.exec(`delete from public.profiles; insert into public.profiles(id, role) values ('00000000-0000-0000-0000-0000000000ad','admin'),('00000000-0000-0000-0000-0000000000a2','parent');`);

const pack = readFileSync(join(here, '..', 'database/v12.5-schema-doctor.sql'), 'utf8')
  .split('\n').filter(l => !/^\s*(notify\s+pgrst|select\s+pg_notify)/i.test(l)).join('\n');
await db.exec(pack);

console.log('\n— retro-markers detect real artifacts —');
const keys = (await q(`select key from public.sc_install_state order by key`)).map(r => r.key);
ok('v10.7 detected (portal_locked col)', keys.includes('v10.7-fee-locks-arrears.sql'));
ok('v11.7 detected (admission_year col)', keys.includes('v11.7-admission-year.sql'));
ok('v11.9 detected (sc_poll_results fn)', keys.includes('v11.9-voting-integrity.sql'));
ok('v12.0 detected (staff.date_of_birth)', keys.includes('v12.0-audit-columns.sql'));
ok('v12.2 detected (photo-sync TRIGGER — the unprobeable one)', keys.includes('v12.2-photo-sync.sql'));
ok('v12.3 detected (checkins.status)', keys.includes('v12.3-write-columns.sql'));
ok('v12.5 self-marker present', keys.includes('v12.5-schema-doctor.sql'));
ok('v10.9b NOT claimed (fn absent in this sandbox)', !keys.includes('v10.9b-fee-doctor.sql'));
ok('v11.0 NOT claimed (fn absent)', !keys.includes('v11.0-timetable-pro.sql'));

console.log('\n— reader RPC gating —');
await db.exec(`update auth_uid_holder set uid='00000000-0000-0000-0000-0000000000ad'`);
const admin = (await q(`select public.sc_installed_packs() j`))[0].j;
ok('admin sees the pack list (' + admin.length + ')', Array.isArray(admin) && admin.length >= 7);
await db.exec(`update auth_uid_holder set uid='00000000-0000-0000-0000-0000000000a2'`);
const parent = (await q(`select public.sc_installed_packs() j`))[0].j;
ok('parent gets an empty list (install state is staff-only)', Array.isArray(parent) && parent.length === 0);

console.log('\n— idempotence —');
await db.exec(pack);
const n2 = (await q(`select count(*)::int n from public.sc_install_state`))[0].n;
ok('re-run adds nothing new', n2 === keys.length);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
