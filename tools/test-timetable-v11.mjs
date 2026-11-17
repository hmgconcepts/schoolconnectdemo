#!/usr/bin/env node
/* V11.0 regression — ENGINE 11 + Overload Analyzer.
   Proves the user's exact complaints are fixed:
     1. FULL-FILL (issue 2): 8 subjects × 5 = 40 periods into a 40-slot week
        with restricted subjects creating greedy dead-ends → the repair-swap
        phase still reaches 40/40.
     2. RESTRICTED FAIRNESS (issue 3): one teacher's subject restricted to
        the same 5 periods across 3 classes → every class receives at least
        one of the scarce slots (round-robin via restricted-first phase and
        cross-class teacher checks) and NO class is starved to zero while
        another eats every slot it could.
     3. OVERLOAD ANALYZER (issue 4): sc_timetable_capacity flags
        over-capacity classes, too-small restricted windows and overloaded
        teachers with actionable advice; clean setups return zero findings.
*/
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid()returns uuid language sql stable as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
create function public.is_staff(uuid)returns boolean language sql stable as $$select true$$;
create function public.sc_can_edit(text)returns boolean language sql stable as $$select true$$;
create table timetable_requirements(id uuid primary key default gen_random_uuid(),class text,subject text,teacher text,periods_per_week int,available_days text[],is_part_time boolean default false,available_periods jsonb,double_periods int default 0,max_period int,unique(class,subject));
create table teacher_availability(id uuid primary key default gen_random_uuid(),teacher text unique,available_days text[],available_periods jsonb);
create table timetable(id uuid primary key default gen_random_uuid(),class text,day text,period text,subject text,teacher text,session text,term text);
create table timetable_runs(id uuid primary key default gen_random_uuid(),class text,session text,term text,generated_at timestamptz,conflicts int,notes text);
create table timetable_blocks(id uuid primary key default gen_random_uuid(),class text default 'ALL',day text,period int,label text,created_at timestamptz default now(),unique(class,day,period));`);
const pack = fs.readFileSync(new URL('../database/v11.0-timetable-pro.sql', import.meta.url), 'utf8')
  .split('\n').filter(l => !/^\s*notify pgrst/.test(l) && !/pg_notify/.test(l)).join('\n');
await db.exec(pack);

/* ---- 1. FULL-FILL: 40 demanded, 40 slots (8/day × 5), restrictions create
        dead-ends a greedy pass alone cannot solve. ---- */
await db.exec(`insert into timetable_requirements(class,subject,teacher,periods_per_week,available_periods)values
 ('SS 1','Yoruba','Yoruba T',5,'{"Monday":[1,2,3,4,5],"Tuesday":[1,2,3,4,5]}'::jsonb);
insert into timetable_requirements(class,subject,teacher,periods_per_week,max_period)values
 ('SS 1','Mathematics','Math T',5,4);
insert into timetable_requirements(class,subject,teacher,periods_per_week)values
 ('SS 1','English','Eng T',5),('SS 1','Biology','Bio T',5),('SS 1','Chemistry','Chem T',5),
 ('SS 1','Physics','Phy T',5),('SS 1','Economics','Eco T',5),('SS 1','Civic','Civ T',5);`);
const g1 = (await db.query(`select public.generate_timetable('SS 1','2026/2027','First Term',8) d`)).rows[0].d;
if (!g1.ok) throw Error('gen failed: ' + JSON.stringify(g1));
if (g1.engine !== '11') throw Error('engine marker must be 11, got ' + g1.engine);
if (g1.placed !== 40 || g1.unplaced !== 0) throw Error('full-fill failed: placed ' + g1.placed + '/40, unplaced ' + g1.unplaced + ' items=' + JSON.stringify(g1.unplaced_items));
// verify no empty periods: all 40 grid cells hold real subjects
const cells = (await db.query(`select count(*)::int n from timetable where class='SS 1'`)).rows[0].n;
if (cells !== 40) throw Error('grid holds ' + cells + ' cells, expected 40');
// restrictions honoured
const yor = (await db.query(`select day,period from timetable where class='SS 1' and subject like 'Yoruba%'`)).rows;
if (!yor.every(x => (x.day==='Monday'||x.day==='Tuesday') && Number(x.period)<=5)) throw Error('Yoruba escaped its window');
const mth = (await db.query(`select period from timetable where class='SS 1' and subject like 'Mathematics%'`)).rows;
if (!mth.every(x => Number(x.period)<=4)) throw Error('Mathematics escaped max_period');

/* ---- 2. RESTRICTED FAIRNESS: same teacher, same restricted window, 3 classes.
        Window = Mon P1-2 + Wed P1-2 + Fri P1-2 = 6 scarce teacher-slots; each of
        3 classes demands 2 → exactly fits IF shared fairly. ---- */
await db.exec(`delete from timetable;delete from timetable_requirements;`);
for (const cls of ['JSS 1','JSS 2','JSS 3']) {
  await db.query(`insert into timetable_requirements(class,subject,teacher,periods_per_week,available_periods)values($1,'CRS','Rev Teacher',2,'{"Monday":[1,2],"Wednesday":[1,2],"Friday":[1,2]}'::jsonb)`,[cls]);
  await db.query(`insert into timetable_requirements(class,subject,teacher,periods_per_week)values($1,'English','E-'||$1,4),($1,'Maths','M-'||$1,4)`,[cls]);
}
for (const cls of ['JSS 1','JSS 2','JSS 3']) {
  const g = (await db.query(`select public.generate_timetable($1,'2026/2027','First Term',6) d`,[cls])).rows[0].d;
  if (!g.ok) throw Error(cls+' gen failed: '+JSON.stringify(g));
}
const perClass = {};
for (const cls of ['JSS 1','JSS 2','JSS 3']) {
  perClass[cls] = (await db.query(`select count(*)::int n from timetable where class=$1 and subject like 'CRS%'`,[cls])).rows[0].n;
}
const counts = Object.values(perClass);
if (counts.reduce((a,b)=>a+b,0) !== 6) throw Error('CRS total wrong: '+JSON.stringify(perClass));
if (counts.some(n => n !== 2)) throw Error('restricted slots not shared fairly: '+JSON.stringify(perClass));
// no teacher double-booking across the three classes
const clash = (await db.query(`select day,period,count(*)::int n from timetable where teacher='Rev Teacher' group by day,period having count(*)>1`)).rows;
if (clash.length) throw Error('Rev Teacher double-booked: '+JSON.stringify(clash));

/* ---- 3. OVERLOAD ANALYZER ---- */
// clean setup → zero findings
let capRes = (await db.query(`select public.sc_timetable_capacity(array['JSS 1','JSS 2','JSS 3'],6,null) d`)).rows[0].d;
if (!capRes.ok || capRes.finding_count !== 0) throw Error('clean setup should have 0 findings: '+JSON.stringify(capRes.findings));
// (a) over-capacity
await db.query(`insert into timetable_requirements(class,subject,teacher,periods_per_week)values('JSS 1','Overflow','O T',40)`);
capRes = (await db.query(`select public.sc_timetable_capacity(array['JSS 1'],6,null) d`)).rows[0].d;
if (!(capRes.findings||[]).some(f=>f.kind==='over_capacity')) throw Error('over_capacity not flagged');
await db.query(`delete from timetable_requirements where subject='Overflow'`);
// (b) window too small
await db.query(`insert into timetable_requirements(class,subject,teacher,periods_per_week,available_periods)values('JSS 1','Tiny','T T',5,'{"Monday":[1,2]}'::jsonb)`);
capRes = (await db.query(`select public.sc_timetable_capacity(array['JSS 1'],6,null) d`)).rows[0].d;
if (!(capRes.findings||[]).some(f=>f.kind==='window_too_small'&&f.subject==='Tiny')) throw Error('window_too_small not flagged');
await db.query(`delete from timetable_requirements where subject='Tiny'`);
// (c) teacher overloaded across classes (Rev Teacher window holds 6; demand 8)
await db.query(`update timetable_requirements set periods_per_week=3 where subject='CRS' and class in ('JSS 1','JSS 2')`);
await db.query(`insert into teacher_availability(teacher,available_periods)values('Rev Teacher','{"Monday":[1,2],"Wednesday":[1,2],"Friday":[1,2]}'::jsonb)`);
capRes = (await db.query(`select public.sc_timetable_capacity(array['JSS 1','JSS 2','JSS 3'],6,null) d`)).rows[0].d;
if (!(capRes.findings||[]).some(f=>f.kind==='teacher_overloaded')) throw Error('teacher_overloaded not flagged: '+JSON.stringify(capRes.findings));

console.log(JSON.stringify({ok:true,engine:'11',
 full_fill:{placed:g1.placed,requested:40,unplaced:g1.unplaced},
 restricted_fairness:perClass,
 analyzer:{clean:0,kinds:['over_capacity','window_too_small','teacher_overloaded']}},null,2));
await db.close();
