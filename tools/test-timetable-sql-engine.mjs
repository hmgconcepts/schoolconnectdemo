#!/usr/bin/env node
import fs from 'node:fs';import{PGlite}from'@electric-sql/pglite';const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid()returns uuid language sql stable as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;create function public.is_staff(uuid)returns boolean language sql stable as $$select true$$;create function public.sc_can_edit(text)returns boolean language sql stable as $$select true$$;
create table timetable_requirements(id uuid primary key default gen_random_uuid(),class text,subject text,teacher text,periods_per_week int,available_days text[],is_part_time boolean default false,unique(class,subject));create table teacher_availability(id uuid primary key default gen_random_uuid(),teacher text unique,available_days text[]);create table timetable(id uuid primary key default gen_random_uuid(),class text,day text,period text,subject text,teacher text,session text,term text);create table timetable_runs(id uuid primary key default gen_random_uuid(),class text,session text,term text,generated_at timestamptz,conflicts int,notes text);create table timetable_config(id uuid primary key default gen_random_uuid(),class text default 'ALL',period_no int,label text,start_time text,end_time text,is_break boolean,position int,unique(class,period_no));alter table timetable_requirements add column available_periods jsonb;alter table teacher_availability add column available_periods jsonb;create table timetable_blocks(id uuid primary key default gen_random_uuid(),class text default 'ALL',day text,period int,label text,created_at timestamptz default now(),unique(class,day,period));`);const sql=fs.readFileSync(new URL('../database/complete-schema.sql',import.meta.url),'utf8'),start=sql.indexOf('-- Conflict-aware timetable generator (single authoritative definition).');if(start<0)throw Error('authoritative timetable section missing');const end=sql.indexOf('-- ============================================================================\n-- SECTION 7b:',start);if(end<0)throw Error('timetable section end missing');await db.exec(sql.slice(start,end));
// V11.0: the engine now lives in its own pack (ENGINE 11 — restricted-first + repair-swap).
const pack=fs.readFileSync(new URL('../database/v11.0-timetable-pro.sql',import.meta.url),'utf8').split('\n').filter(l=>!/^\s*notify pgrst/.test(l)&&!/pg_notify/.test(l)).join('\n');
await db.exec(pack);
await db.exec(`insert into timetable_requirements(class,subject,teacher,periods_per_week,available_days,is_part_time)values('JSS 1','Mathematics','Teacher A',3,array['Monday','Wednesday'],true),('JSS 1','English','Teacher B',2,null,false);insert into timetable(class,day,period,subject,teacher,session,term)values('JSS 2','Monday','1','Basic Science','Teacher A','2026/2027','First Term');`);const out=(await db.query(`select public.generate_timetable('JSS 1','2026/2027','First Term',4)d`)).rows[0].d;if(!out.ok||out.placed!==5||out.unplaced!==0)throw Error('generation failed '+JSON.stringify(out));const rows=(await db.query(`select * from timetable where class='JSS 1' order by day,period`)).rows;if(rows.filter(x=>x.teacher==='Teacher A').some(x=>!['Monday','Wednesday'].includes(x.day)))throw Error('restricted day violated');if(rows.some(x=>x.teacher==='Teacher A'&&x.day==='Monday'&&x.period==='1'))throw Error('cross-class teacher conflict');const numeric=(await db.query(`select data_type from information_schema.columns where table_name='timetable_config'and column_name='period_no'`)).rows[0].data_type;if(numeric!=='numeric')throw Error('break-compatible period_no migration failed: '+numeric);// V7.9 regression: period-level availability + blocked slot + short Friday
await db.exec(`delete from timetable where class='JSS 1';delete from timetable_requirements;insert into timetable_blocks(class,day,period,label)values('ALL','Wednesday',3,'Sports');insert into timetable_requirements(class,subject,teacher,periods_per_week,is_part_time,available_periods)values('JSS 1','Further Maths','PT Teacher',4,true,'{"Monday":[1,2],"Thursday":[3,4]}'::jsonb);insert into timetable_requirements(class,subject,teacher,periods_per_week)values('JSS 1','English','FT Teacher',6);`);
const out2=(await db.query(`select public.generate_timetable('JSS 1','2026/2027','First Term',4,'{"Friday":2}'::jsonb)d`)).rows[0].d;
const rows2=(await db.query(`select day,period,subject,teacher from timetable where class='JSS 1'`)).rows;
const pt2=rows2.filter(x=>x.teacher==='PT Teacher');
if(!out2.ok)throw Error('v7.9 generation failed '+JSON.stringify(out2));
if(!pt2.every(x=>(x.day==='Monday'&&['1','2'].includes(x.period))||(x.day==='Thursday'&&['3','4'].includes(x.period))))throw Error('v7.9 period map violated');
if(!rows2.filter(x=>x.day==='Friday').every(x=>Number(x.period)<=2))throw Error('v7.9 short Friday violated');
if(!rows2.some(x=>x.day==='Wednesday'&&x.period==='3'&&x.subject.indexOf('⛔')===0))throw Error('v7.9 blocked slot missing');
// V9.1 regressions: (4a) double periods adjacent · (4b) teacher_availability ALWAYS enforced · (4c) max_period cap
await db.exec(`alter table timetable_requirements add column if not exists double_periods int default 0;alter table timetable_requirements add column if not exists max_period int;
delete from timetable where class='JSS 1';delete from timetable_requirements;delete from timetable_blocks;delete from teacher_availability;
insert into timetable_requirements(class,subject,teacher,periods_per_week,double_periods)values('JSS 1','Physics','Lab Teacher',4,2);
insert into timetable_requirements(class,subject,teacher,periods_per_week,max_period)values('JSS 1','Mathematics','Math Teacher',5,2);
insert into timetable_requirements(class,subject,teacher,periods_per_week)values('JSS 1','English','Eng Teacher',5);
insert into teacher_availability(teacher,available_days)values('Eng Teacher',array['Tuesday','Thursday']);`);
const out3=(await db.query(`select public.generate_timetable('JSS 1','2026/2027','First Term',6)d`)).rows[0].d;
if(!out3.ok)throw Error('v9.1 generation failed '+JSON.stringify(out3));
const rows3=(await db.query(`select day,period,subject,teacher from timetable where class='JSS 1'`)).rows;
// 4a: doubles adjacent on same day
const dbl=rows3.filter(x=>x.subject==='Physics (double)');
if(dbl.length!==4)throw Error('v9.1 expected 4 double-period slots, got '+dbl.length);
const byDay={};dbl.forEach(x=>{(byDay[x.day]=byDay[x.day]||[]).push(Number(x.period));});
for(const[day,ps]of Object.entries(byDay)){ps.sort((a,b)=>a-b);for(let i=0;i<ps.length;i+=2)if(ps[i+1]!==ps[i]+1)throw Error('v9.1 double periods not adjacent on '+day+': '+ps.join(','));}
// 4c: max_period cap respected
if(rows3.filter(x=>x.subject==='Mathematics').some(x=>Number(x.period)>2))throw Error('v9.1 max_period cap violated');
// 4b: teacher_availability enforced even though requirement has no restriction
if(rows3.filter(x=>x.teacher==='Eng Teacher').some(x=>!['Tuesday','Thursday'].includes(x.day)))throw Error('v9.1 teacher_availability ignored');
// 4b bis: requirement restriction AND teacher restriction combine (intersection)
await db.exec(`delete from timetable where class='JSS 1';delete from timetable_requirements;
insert into timetable_requirements(class,subject,teacher,periods_per_week,available_days,is_part_time)values('JSS 1','Chemistry','PT2',2,array['Monday','Tuesday'],true);
insert into teacher_availability(teacher,available_days)values('PT2',array['Tuesday','Friday']);`);
const out4=(await db.query(`select public.generate_timetable('JSS 1','2026/2027','First Term',6)d`)).rows[0].d;
const rows4=(await db.query(`select day from timetable where class='JSS 1' and subject like 'Chemistry%'`)).rows;
if(rows4.some(x=>x.day!=='Tuesday'))throw Error('v9.1 intersection (req∩teacher days) violated: '+JSON.stringify(rows4));
// V9.4 (#7) regression: MANY subjects with doubles — EVERY one must get its pairs
await db.exec(`delete from timetable where class='JSS 1';delete from timetable_requirements;delete from teacher_availability;
insert into timetable_requirements(class,subject,teacher,periods_per_week,double_periods)values
('JSS 1','Physics','T1',4,2),('JSS 1','Chemistry','T2',4,2),('JSS 1','Biology','T3',4,2),('JSS 1','F-Maths','T4',4,2);
insert into timetable_requirements(class,subject,teacher,periods_per_week)values('JSS 1','English','T5',6),('JSS 1','Maths','T6',6);`);
const out5=(await db.query(`select public.generate_timetable('JSS 1','2026/2027','First Term',6)d`)).rows[0].d;
if(!out5.ok)throw Error('v9.4 generation failed '+JSON.stringify(out5));
const rows5=(await db.query(`select day,period,subject from timetable where class='JSS 1'`)).rows;
for(const s of ['Physics','Chemistry','Biology','F-Maths']){
  const dbls=rows5.filter(x=>x.subject===s+' (double)');
  if(dbls.length!==4)throw Error('v9.4 two-phase failed: '+s+' has '+dbls.length+' double slots (expected 4)');
  const byDay={};dbls.forEach(x=>{(byDay[x.day]=byDay[x.day]||[]).push(Number(x.period));});
  for(const[day,ps]of Object.entries(byDay)){ps.sort((a,b)=>a-b);for(let i=0;i<ps.length;i+=2)if(ps[i+1]!==ps[i]+1)throw Error('v9.4 pair not adjacent for '+s+' on '+day);}
  // weekly count exact: 2 doubles (4 slots) + 0 singles = 4 = ppw
  if(rows5.filter(x=>x.subject===s||x.subject===s+' (double)').length!==4)throw Error('v9.4 weekly count wrong for '+s);
}
// ghost-subject guard: ONLY demanded subjects may appear
const allowed=new Set(['Physics (double)','Chemistry (double)','Biology (double)','F-Maths (double)','Physics','Chemistry','Biology','F-Maths','English','Maths']);
for(const r of rows5)if(!allowed.has(r.subject)&&!r.subject.startsWith('⛔'))throw Error('v9.4 ghost subject in grid: '+r.subject);
console.log(JSON.stringify({ok:true,placed:out.placed,unplaced:out.unplaced,restricted_days_respected:true,cross_class_teacher_conflict_avoided:true,break_period_type:numeric,v79_period_map:true,v79_blocked_slot:true,v79_short_friday:true,v91_double_adjacent:true,v91_max_period:true,v91_teacher_availability_always:true,v91_intersection:true,v94_all_subjects_get_doubles:true,v94_no_ghost_subjects:true},null,2));await db.close();
