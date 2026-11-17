// ============================================================================
// V11.9 voting-integrity pack — PGlite proof (pass 67)
// Proves, against a real PostgreSQL engine:
//   1. THE 0% BUG IS DEAD: a student who voted sees the FULL tally via
//      sc_poll_results (aggregates), even though pv_read RLS hides other
//      ballots from a direct select.
//   2. STRICT AUDIENCE: staff/parents/admin CANNOT insert into a
//      students-only ballot (RLS check via sc_can_vote, no admin bypass).
//   3. ONE MANAGER PER BALLOT: staff B cannot update/delete staff A's poll;
//      the creator and the admin can.
//   4. Revote works (voter deletes own ballot while open) and turnout math
//      is correct against the eligible-student count.
// ============================================================================
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓', name); } else { failed++; console.log('  ✗ FAIL', name); } };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const exec = (sql) => db.exec(sql);

// ---------- environment stubs (established pattern) ----------
await exec(`
create role anon; create role authenticated;
create schema auth;
create table auth_uid_holder(uid uuid);
insert into auth_uid_holder values (null);
create function auth.uid() returns uuid language sql as $$ select uid from auth_uid_holder limit 1 $$;
create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
create table public.profiles(id uuid primary key, role text, status text default 'active', full_name text);
create table public.students(id uuid primary key default gen_random_uuid(), user_id uuid, class text, status text default 'active', full_name text);
create table public.staff(id uuid primary key default gen_random_uuid(), user_id uuid, status text default 'active', full_name text);
create function public.is_admin(uid uuid) returns boolean language sql security definer as
  $$ select exists(select 1 from public.profiles where id=uid and role in ('super_admin','admin','principal','proprietor','head_teacher','bursar')) $$;
create function public.is_staff(uid uuid) returns boolean language sql security definer as
  $$ select exists(select 1 from public.profiles where id=uid and role in ('super_admin','admin','principal','proprietor','head_teacher','bursar','staff','teacher')) $$;
create table public.polls(
  id uuid primary key default gen_random_uuid(), title text, description text,
  candidates jsonb default '[]'::jsonb, opens_at timestamptz default now(), closes_at timestamptz,
  allow_multiple boolean default false, anonymous boolean default false,
  audience text default 'all', class_scope text default '', max_votes int default 1,
  status text default 'open', created_by uuid, created_at timestamptz default now());
create table public.poll_votes(
  id uuid primary key default gen_random_uuid(), poll_id uuid references public.polls(id) on delete cascade,
  candidate_id text not null, voter_id uuid, voted_at timestamptz default now(),
  unique(poll_id, candidate_id, voter_id));
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
create policy polls_read on public.polls for select using (auth.role() = 'authenticated');
create policy polls_write on public.polls for insert with check (public.is_staff(auth.uid()));
create policy pv_read on public.poll_votes for select using (auth.uid() = voter_id or public.is_staff(auth.uid()));
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
`);

// ---------- load the pack (strip notify lines per established pattern) ----------
const pack = readFileSync(join(here, '..', 'database/v11.9-voting-integrity.sql'), 'utf8')
  .split('\n').filter(l => !/^\s*(notify\s+pgrst|select\s+pg_notify)/i.test(l)).join('\n');
await exec(pack);
await exec(`grant execute on function public.sc_can_vote(uuid) to authenticated;
            grant execute on function public.sc_poll_results(uuid) to authenticated;`);

// ---------- actors ----------
const A = { admin:'00000000-0000-0000-0000-00000000000a', staffA:'00000000-0000-0000-0000-0000000000a1',
            staffB:'00000000-0000-0000-0000-0000000000b1', parent:'00000000-0000-0000-0000-0000000000c1',
            stu1:'00000000-0000-0000-0000-0000000000d1', stu2:'00000000-0000-0000-0000-0000000000d2',
            stu3:'00000000-0000-0000-0000-0000000000d3' };
await exec(`
insert into public.profiles(id,role,status) values
 ('${A.admin}','admin','active'),('${A.staffA}','teacher','active'),('${A.staffB}','teacher','active'),
 ('${A.parent}','parent','active'),('${A.stu1}','student','active'),('${A.stu2}','student','active'),('${A.stu3}','student','active');
insert into public.students(user_id,class,full_name) values
 ('${A.stu1}','SS 2','Student One'),('${A.stu2}','SS 2','Student Two'),('${A.stu3}','JSS 1','Student Three');
`);
const as = async (uid) => exec(`update auth_uid_holder set uid='${uid}'`);
const asRole = async (uid) => { await as(uid); await exec(`set role authenticated`); };
const asSuper = async () => exec(`reset role`);

// ---------- staff A creates a STUDENTS-ONLY poll ----------
await asSuper();
await exec(`insert into public.polls(id,title,audience,candidates,created_by,status) values
 ('11111111-1111-1111-1111-111111111111','Head Boy 2026','students',
  '[{"id":"c1","label":"Ade"},{"id":"c2","label":"Bola"}]','${A.staffA}','open')`);
const POLL = '11111111-1111-1111-1111-111111111111';

console.log('\n— strict audience enforcement —');
await asRole(A.stu1);
ok('student CAN vote (sc_can_vote=true)', (await q(`select public.sc_can_vote('${POLL}') v`))[0].v === true);
await exec(`insert into public.poll_votes(poll_id,candidate_id,voter_id) values ('${POLL}','c1','${A.stu1}')`);
await asRole(A.stu2);
await exec(`insert into public.poll_votes(poll_id,candidate_id,voter_id) values ('${POLL}','c1','${A.stu2}')`);
await asRole(A.stu3);
await exec(`insert into public.poll_votes(poll_id,candidate_id,voter_id) values ('${POLL}','c2','${A.stu3}')`);
await asRole(A.parent);
ok('parent CANNOT vote on students ballot (fn)', (await q(`select public.sc_can_vote('${POLL}') v`))[0].v === false);
let blocked = false;
try { await exec(`insert into public.poll_votes(poll_id,candidate_id,voter_id) values ('${POLL}','c1','${A.parent}')`); } catch (_) { blocked = true; }
ok('parent insert BLOCKED by RLS', blocked);
await asRole(A.admin);
ok('ADMIN also cannot vote (no bypass)', (await q(`select public.sc_can_vote('${POLL}') v`))[0].v === false);
blocked = false;
try { await exec(`insert into public.poll_votes(poll_id,candidate_id,voter_id) values ('${POLL}','c2','${A.admin}')`); } catch (_) { blocked = true; }
ok('admin insert BLOCKED by RLS', blocked);
await asRole(A.staffB);
blocked = false;
try { await exec(`insert into public.poll_votes(poll_id,candidate_id,voter_id) values ('${POLL}','c2','${A.staffB}')`); } catch (_) { blocked = true; }
ok('staff insert BLOCKED on students ballot', blocked);

console.log('\n— the 0% bug is dead: full tally for a mere student —');
await asRole(A.stu1);
const direct = await q(`select count(*)::int n from public.poll_votes where poll_id='${POLL}'`);
ok('direct select under RLS sees ONLY own ballot (the old bug source): ' + direct[0].n, direct[0].n === 1);
const res = (await q(`select public.sc_poll_results('${POLL}') r`))[0].r;
ok('sc_poll_results returns FULL tally: c1=2 c2=1', res.tally.c1 === 2 && res.tally.c2 === 1);
ok('total ballots = 3, unique voters = 3', res.total_ballots === 3 && res.unique_voters === 3);
ok('eligible = 3 students, turnout = 100%', res.eligible === 3 && Number(res.turnout_pct) === 100);
ok('my_ballot shows own choice only', JSON.stringify(res.my_ballot) === '["c1"]');
ok('by_role aggregates without identities', res.by_role.student === 3 && !JSON.stringify(res).includes(A.stu2));

console.log('\n— one manager per ballot —');
await asRole(A.staffB);
await exec(`update public.polls set title='HIJACKED' where id='${POLL}'`);
await asSuper();
ok('staff B update SILENTLY IGNORED by RLS (title unchanged)', (await q(`select title from public.polls where id='${POLL}'`))[0].title === 'Head Boy 2026');
await asRole(A.staffB);
await exec(`delete from public.polls where id='${POLL}'`);
await asSuper();
ok('staff B delete ignored (poll still exists)', (await q(`select count(*)::int n from public.polls where id='${POLL}'`))[0].n === 1);
await asRole(A.staffA);
await exec(`update public.polls set description='by creator' where id='${POLL}'`);
await asSuper();
ok('creator CAN update own poll', (await q(`select description from public.polls where id='${POLL}'`))[0].description === 'by creator');
await asRole(A.admin);
await exec(`update public.polls set description='by admin' where id='${POLL}'`);
await asSuper();
ok('admin CAN update any poll', (await q(`select description from public.polls where id='${POLL}'`))[0].description === 'by admin');

console.log('\n— revote + closing rules —');
await asRole(A.stu1);
await exec(`delete from public.poll_votes where poll_id='${POLL}' and voter_id='${A.stu1}'`);
await exec(`insert into public.poll_votes(poll_id,candidate_id,voter_id) values ('${POLL}','c2','${A.stu1}')`);
await asSuper();
const after = (await q(`select public.sc_poll_results('${POLL}') r`))[0].r;
ok('revote recorded: c1=1 c2=2', after.tally.c1 === 1 && after.tally.c2 === 2);
await exec(`update public.polls set status='closed' where id='${POLL}'`);
await asRole(A.stu2);
ok('closed poll refuses new votes (fn)', (await q(`select public.sc_can_vote('${POLL}') v`))[0].v === false);
blocked = false;
try { await exec(`delete from public.poll_votes where poll_id='${POLL}' and voter_id='${A.stu2}'`);
      const n = (await q(`select count(*)::int n from public.poll_votes where poll_id='${POLL}' and voter_id='${A.stu2}'`))[0].n;
      blocked = n === 1; } catch (_) { blocked = true; }
ok('voter cannot withdraw ballot after close', blocked);
await asSuper();
await exec(`update public.polls set status='open', closes_at=now()-interval '1 hour' where id='${POLL}'`);
await asRole(A.stu2);
ok('past closes_at refuses votes even while status=open', (await q(`select public.sc_can_vote('${POLL}') v`))[0].v === false);

console.log('\n— class-scoped ballot —');
await asSuper();
await exec(`insert into public.polls(id,title,audience,class_scope,candidates,created_by,status) values
 ('22222222-2222-2222-2222-222222222222','SS2 Captain','students','SS 2',
  '[{"id":"c1","label":"X"},{"id":"c2","label":"Y"}]','${A.staffA}','open')`);
await asRole(A.stu1);
ok('SS 2 student can vote in SS 2 ballot', (await q(`select public.sc_can_vote('22222222-2222-2222-2222-222222222222') v`))[0].v === true);
await asRole(A.stu3);
ok('JSS 1 student CANNOT vote in SS 2 ballot', (await q(`select public.sc_can_vote('22222222-2222-2222-2222-222222222222') v`))[0].v === false);
await asSuper();
const scoped = (await q(`select public.sc_poll_results('22222222-2222-2222-2222-222222222222') r`))[0].r;
ok('class ballot eligible = 2 (SS 2 only)', scoped.eligible === 2);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
