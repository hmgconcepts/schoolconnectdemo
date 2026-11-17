/* ROUND-16 ITEM 1/2 — prep exams must produce a real report and must NEVER
   reach the report card. Proven on a real PostgreSQL engine, because this is
   the kind of rule that silently rots if it is only enforced in a screen. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { schemaText } from './schema-loader.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const db = new PGlite();
await db.exec(readFileSync(HERE + 'pglite-boot.sql','utf8'));
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
try { await db.exec(schemaText(HERE + '../../database/complete-schema.sql')); }
catch(e){ console.log('SCHEMA FAILED:', e.message.slice(0,500)); process.exit(1); }

const ADMIN='11111111-1111-1111-1111-111111111111';
const TEACH='22222222-2222-2222-2222-222222222222';
await db.exec(`
  insert into auth.users(id,email) values ('${ADMIN}','boss@x.test') on conflict (id) do nothing;
  insert into public.profiles(id,full_name,role,status) values ('${ADMIN}','Boss','admin','approved')
    on conflict (id) do update set full_name='Boss',role='admin',status='approved';
  insert into auth.users(id,email) values ('${TEACH}','t@x.test') on conflict (id) do nothing;
  insert into public.profiles(id,full_name,role,status) values ('${TEACH}','Miss Ada','teacher','approved')
    on conflict (id) do update set full_name='Miss Ada',role='teacher',status='approved';
  select set_config('request.jwt.claim.sub','${ADMIN}',false);
`);
let pass=0, fail=0;
const ok=(c,n,d)=>{ if(c) pass++; else { fail++; console.log('  FAIL',n,d===undefined?'':JSON.stringify(d).slice(0,300)); } };
const q=async(s,p)=>(await db.query(s,p)).rows;
const rpc=async(fn,args)=>JSON.parse(JSON.stringify((await q(`select public.${fn}(${args}) r`))[0].r));

/* ---- the purpose registry ---- */
const purp=await rpc('sc_purposes',``);
ok(Array.isArray(purp)&&purp.length>=8,'the registry ships the built-in purposes',purp&&purp.length);
const prep=purp.find(p=>p.slug==='prep');
ok(!!prep,'a "prep" purpose exists out of the box',!!prep);
ok(prep&&prep.report_eligible===false,'the prep purpose is NOT report-eligible',prep&&prep.report_eligible);
ok(prep&&prep.feeds_report==='prep','the prep purpose feeds the prep report',prep&&prep.feeds_report);

/* ---- custom purposes (item 2) ---- */
const c1=await rpc('sc_purpose_create',`'Mock UTME','🎯',true,'none'`);
ok(c1.ok===true,'a teacher can create a custom purpose',c1);
ok(c1.slug==='mock_utme','the slug is derived from the label',c1.slug);
const c2=await rpc('sc_purpose_create',`'Mock UTME','🎯',true,'none'`);
ok(c2.ok===false&&/already exists/.test(c2.error||''),'a duplicate purpose is refused clearly',c2);
const c3=await rpc('sc_purpose_create',`'   ','⚪',true,'none'`);
ok(c3.ok===false,'an empty purpose name is refused',c3);
const c4=await rpc('sc_purpose_create',`'Christmas Rehearsal','🧪',false,'prep'`);
ok(c4.ok===true&&c4.report_eligible===false,'a custom REHEARSAL purpose can be created',c4);
ok(await rpc('sc_purpose_report_eligible',`'prep'`)===false,'prep is not report-eligible');
ok(await rpc('sc_purpose_report_eligible',`'exam'`)===true,'exam is report-eligible');
ok(await rpc('sc_purpose_report_eligible',`'something_nobody_defined'`)===true,'an unknown purpose defaults to ELIGIBLE so no score is ever lost');
ok(await rpc('sc_is_prep_assessment',`'prep'`)===true,'prep is recognised as a rehearsal');
ok(await rpc('sc_is_prep_assessment',`'christmas_rehearsal'`)===true,'a custom rehearsal is recognised too');
ok(await rpc('sc_is_prep_assessment',`'midterm'`)===false,'a midterm is not a rehearsal');
ok(await rpc('sc_is_midterm_column',`'Midterm Test','prep'`)===false,'a prep column can never be a midterm column');

/* ---- learners + real report structure ---- */
const a=(await q(`insert into students(full_name,class,admission_no,status)
  values('Ada Prep','JSS 1','SC/101','active') returning id`))[0].id;
const b=(await q(`insert into students(full_name,class,admission_no,status)
  values('Bola Prep','JSS 1','SC/102','active') returning id`))[0].id;
await q(`insert into assessment_columns(class,subject,term,session,name,max_mark,cbt_assessment_type)
  values ('JSS 1','Mathematics','First Term','2025/2026','Midterm Test',20,'midterm')`);
const col=(await q(`select id from assessment_columns where name='Midterm Test'`))[0].id;

/* ---- prep scores land in the prep ledger only ---- */
await q(`insert into prep_scores(column_id,student_id,student_id_ref,student_name,class,subject,term,session,score,max_mark)
  values ($1,$2,'SC/101','Ada Prep','JSS 1','Mathematics','First Term','2025/2026',18,20)`, [col,a]);
await q(`insert into prep_scores(column_id,student_id,student_id_ref,student_name,class,subject,term,session,score,max_mark)
  values ($1,$2,'SC/102','Bola Prep','JSS 1','Mathematics','First Term','2025/2026',9,20)`, [col,b]);

const gen=await rpc('sc_prep_generate',`'JSS 1','First Term','2025/2026'`);
ok(gen.ok===true,'a prep sheet generates for the class',gen);
ok(Number(gen.prep_marks)===2,'both prep marks are seen',gen.prep_marks);
const list=await rpc('sc_prep_list',`'JSS 1','First Term','2025/2026'`);
ok(list.ok===true&&list.rows.length===2,'the prep report lists both learners',list.rows&&list.rows.length);
const ada=list.rows.find(r=>r.admission_no==='SC/101');
ok(ada&&Number(ada.total)===18,'the prep total is the prep mark',ada&&ada.total);
ok(ada&&ada.readiness_band==='ready','a strong prep score reads as ready',ada&&ada.readiness_band);
const bola=list.rows.find(r=>r.admission_no==='SC/102');
ok(bola&&bola.readiness_band!=='ready','a weak prep score does not read as ready',bola&&bola.readiness_band);
ok(/never part of the report card/i.test(list.warning||''),'the prep report carries its own warning',list.warning);

/* ---- THE HARD BLOCK: prep must never reach a report card ---- */
let blocked=false, msg='';
try {
  await q(`insert into report_scores(column_id,student_id,student_id_ref,student_name,class,subject,term,session,score)
           values ($1,$2,'SC/101','Ada Prep','JSS 1','Mathematics','First Term','2025/2026',18)`, [col,a]);
} catch(e){ blocked=true; msg=e.message; }
/* the column here is a genuine midterm column, so this insert is legitimate —
   the guard must NOT block it. It proves the guard is targeted, not blunt. */
ok(blocked===false,'an ordinary midterm score is still allowed into report_scores',msg);

/* now a prep-flavoured COLUMN must be refused */
await q(`insert into assessment_columns(class,subject,term,session,name,max_mark,cbt_assessment_type)
  values ('JSS 1','Mathematics','First Term','2025/2026','Prep Rehearsal',20,'prep')`);
const pcol=(await q(`select id from assessment_columns where name='Prep Rehearsal'`))[0].id;
let blocked2=false, msg2='';
try {
  await q(`insert into report_scores(column_id,student_id,student_id_ref,student_name,class,subject,term,session,score)
           values ($1,$2,'SC/101','Ada Prep','JSS 1','Mathematics','First Term','2025/2026',18)`, [pcol,a]);
} catch(e){ blocked2=true; msg2=e.message; }
ok(blocked2===true,'a prep column is REFUSED entry into report_scores',msg2);
ok(/prep|rehearsal/i.test(msg2),'the refusal explains why',msg2);

let blocked3=false;
try {
  await q(`insert into results(student_id,student_name,student_id_ref,subject,class,term,session,assessment_source)
           values ($1,'Ada Prep','SC/101','Mathematics','JSS 1','First Term','2025/2026','prep')`, [a]);
} catch(e){ blocked3=true; }
ok(blocked3===true,'a prep score is REFUSED entry into the results ledger');

/* the midterm engine must not see prep scores at all */
/* the prep marks are in prep_scores; the report-card ledgers must be clean of
   them. (midterm_report_cards may legitimately hold rows from the ordinary
   midterm insert earlier in this file, so assert on the PREP VALUES.) */
const leakRep=(await q(`select count(*) n from report_scores where score=18 and column_id=$1`,[pcol]))[0];
ok(Number(leakRep.n)===0,'no prep value reached report_scores',leakRep.n);
const leakRes=(await q(`select count(*) n from results where assessment_source='prep'`))[0];
ok(Number(leakRes.n)===0,'no prep value reached the results ledger',leakRes.n);
const inPrep=(await q(`select count(*) n from prep_scores`))[0];
ok(Number(inPrep.n)===2,'both prep marks are held in the prep ledger',inPrep.n);

/* ---- CBT window (item 4) ---- */
const ex=(await q(`insert into cbt_exams(teacher_id,code,title,subject,class,term,session,assessment_type,is_open)
  values ($1,'PREP1','Prep Maths','Mathematics','JSS 1','First Term','2025/2026','prep',true) returning id`,[TEACH]))[0].id;
const w1=await rpc('sc_cbt_window_state',`'${ex}'`);
ok(w1.allow===true,'an open exam with no window allows entry',w1);
await q(`update cbt_exams set start_at = now() + interval '2 days' where id=$1`,[ex]);
const w2=await rpc('sc_cbt_window_state',`'${ex}'`);
ok(w2.allow===false&&w2.state==='not_started','a future start blocks entry',w2);
ok(/opens on/i.test(w2.message||''),'the learner is told WHEN it opens',w2.message);
ok(Number(w2.seconds_until)>0,'a countdown is provided',w2.seconds_until);
await q(`update cbt_exams set start_at = now() - interval '2 days', close_at = now() - interval '1 hour' where id=$1`,[ex]);
const w3=await rpc('sc_cbt_window_state',`'${ex}'`);
ok(w3.allow===false&&w3.state==='expired','a past close blocks entry',w3);
ok(/closed on/i.test(w3.message||''),'the learner is told WHEN it closed',w3.message);
const bad=await rpc('sc_cbt_set_window',`'${ex}', now(), now() - interval '1 hour'`);
ok(bad.ok===false&&/AFTER/.test(bad.error||''),'a close before the start is refused',bad);

/* ---- prep does not mirror into assignments ---- */
const asg=(await q(`select count(*) n from assignments where cbt_exam_id=$1`,[ex]))[0];
ok(Number(asg.n)===0,'a prep exam does NOT create a homework assignment',asg.n);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
