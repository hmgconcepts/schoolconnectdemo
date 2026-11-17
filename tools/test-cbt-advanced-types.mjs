#!/usr/bin/env node
/* V10.3 regression — advanced CBT types (server) + per-student fee override.
   Loads the V5.1 CBT engine, then the V10.3 pack, into PGlite and proves:
     1. Structured Items/Pairs payloads are SANITISED by the public getter
        (no pairings / order / categories / flags / answers leak) while the
        render shapes (items, pool, blanks) survive.
     2. cbt_submit_v5 grades structured types with per-row PARTIAL credit and
        still grades binary types identically (no regression).
     3. A structured question with Items but no CorrectAnswer is NOT rejected
        as answer_key_missing.
     4. sc_student_fee_state honours a deliberate total_overridden fee row as
        the student's personal total due (pass-51 issue 4 root cause). */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const staff='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222',exam='44444444-4444-4444-8444-444444444444';

await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid()returns uuid language sql stable as $$select '${staff}'::uuid$$;
create function auth.jwt()returns jsonb language sql stable as $$select '{}'::jsonb$$;
create table students(id uuid primary key,admission_no text,full_name text,class text,arm text,department text,status text default 'active',user_id uuid,guardian_email text);
create table cbt_roster(id uuid primary key default gen_random_uuid(),exam_id uuid,student_id_ref text,full_name text,class text);
create table school_settings(id int primary key,school_name text,short_name text,motto text,address text,phone text,email text,logo_url text);insert into school_settings values(1,'Adv School','AS','Truth','Lagos','0800','a@example.com','logo.svg');
create table cbt_exams(id uuid primary key,code text,title text,subject text default 'General',class text,term text,session text,assessment_type text default 'exam',duration int default 45,duration_min int default 45,max_score numeric default 100,exam_mode text default 'open',is_open boolean default true,is_archived boolean default false,start_at timestamptz,close_at timestamptz,attempt_limit int default 3,randomise boolean default false,select_count int default 0,negative_mark numeric default 0,pass_mark numeric default 50,release_results boolean default true,certificate_enabled boolean default false,report_column text,instructions text default '',anti_cheat_config jsonb default '{}',csv_data jsonb default '[]',questions jsonb default '[]',created_at timestamptz default now(),updated_at timestamptz default now());
create table cbt_results(id uuid primary key default gen_random_uuid(),exam_id uuid,student_id uuid,student_name text,student_class text,student_id_ref text,student_type text,score numeric,total numeric,percent numeric,correct_count int,wrong_count int,skipped_count int,ungraded_count int default 0,grading_status text default 'graded',engine_version text default '',attempt_number int,time_taken int,violations int,violation_log jsonb,answers_data jsonb,cert_code text,client_ref text,subject_scores jsonb default '{}',submitted_at timestamptz default now(),unique(exam_id,client_ref));
create function public.is_staff(uuid)returns boolean language sql stable as $$select true$$;
create function public.is_parent_of(uuid,uuid)returns boolean language sql stable as $$select false$$;
create function public.sc_cbt_norm(text)returns text language sql immutable as $$select lower(regexp_replace(trim(coalesce($1,'')),'\\\\s+',' ','g'))$$;
create table academic_periods(id int primary key,term text,session text,is_current boolean default false);insert into academic_periods values(1,'Third Term','2025/2026',true);
create table class_fee_structure(id uuid primary key default gen_random_uuid(),class text,arm text default '',department text default '',term text default 'Current Term',session text default '',tuition numeric default 0,exam_fee numeric default 0,development numeric default 0,transport numeric default 0,boarding numeric default 0,other_fee numeric default 0,discount numeric default 0,total numeric default 0,amount numeric default 0,currency text default '₦',due_date date,note text default '',active boolean default true,updated_at timestamptz default now());
create table fee_payments(id uuid primary key default gen_random_uuid(),student_id uuid,student_name text,amount_paid numeric,fee_total numeric,balance numeric,method text,reference text,term text,session text,created_at timestamptz default now());
create table module_records(id uuid primary key default gen_random_uuid(),module text,title text,amount numeric,status text,data jsonb default '{}');
insert into students(id,admission_no,full_name,class,arm,status)values('${student}','ADV-1','Fee Student','JSS 1','A','active');
insert into class_fee_structure(class,term,session,tuition,total)values('JSS 1','Third Term','2025/2026',200000,200000);`);

const hotfix = fs.readFileSync(new URL('../database/cbt-v5.1-zero-score-hotfix.sql', import.meta.url), 'utf8');
await db.exec(hotfix);
const pack = fs.readFileSync(new URL('../database/v10.3-cbt-advanced-types.sql', import.meta.url), 'utf8');
await db.exec(pack);

/* ---- 1. Sanitised getter shapes ---- */
const matchQ = { question:'Match symbols', type:'matching', mark:3,
  pairs:'[{"left":"Na","right":"Sodium"},{"left":"K","right":"Potassium"},{"left":"Fe","right":"Iron"}]', accept:'Calcium' };
const pubMatch = (await db.query(`select public.sc_cbt_public_question($1::jsonb) q`,[JSON.stringify(matchQ)])).rows[0].q;
if (JSON.stringify(pubMatch).includes('Sodium') && !pubMatch.pool) throw Error('matching sanitise failed: '+JSON.stringify(pubMatch));
if (!pubMatch.items || pubMatch.items.length!==3 || pubMatch.items[0].left!=='Na' || pubMatch.items[0].right) throw Error('matching items wrong: '+JSON.stringify(pubMatch.items));
if (!pubMatch.pool || pubMatch.pool.length!==4) throw Error('matching pool wrong (expect 3 rights + 1 distractor): '+JSON.stringify(pubMatch.pool));

const ordQ = { question:'Order planets', type:'ordering', mark:4, items:'["Mercury","Venus","Earth","Mars"]' };
const pubOrd = (await db.query(`select public.sc_cbt_public_question($1::jsonb) q`,[JSON.stringify(ordQ)])).rows[0].q;
if (!pubOrd.items || pubOrd.items.length!==4) throw Error('ordering items lost');
if (JSON.stringify(pubOrd.items)===JSON.stringify(['Mercury','Venus','Earth','Mars'])) throw Error('ordering leaked the correct order (must be alphabetical)');

const hotQ = { question:'Tap evens', type:'hot_text', mark:2, items:'[{"text":"3","correct":false},{"text":"4","correct":true},{"text":"10","correct":true}]' };
const pubHot = (await db.query(`select public.sc_cbt_public_question($1::jsonb) q`,[JSON.stringify(hotQ)])).rows[0].q;
if (JSON.stringify(pubHot).includes('correct')) throw Error('hot_text leaked flags: '+JSON.stringify(pubHot));

const clozeQ = { question:'F = m ___ and weight = m ___', type:'cloze', mark:2, items:'["a|acceleration","g"]' };
const pubCloze = (await db.query(`select public.sc_cbt_public_question($1::jsonb) q`,[JSON.stringify(clozeQ)])).rows[0].q;
if (pubCloze.items || pubCloze.blanks!==2) throw Error('cloze sanitise failed: '+JSON.stringify(pubCloze));

/* ---- 2 & 3. Structured grading with partial credit ---- */
const bank = [
  matchQ,                                                              // 0: 3 marks
  ordQ,                                                                // 1: 4 marks
  hotQ,                                                                // 2: 2 marks
  clozeQ,                                                              // 3: 2 marks
  { question:'x+y=5, x-y=1', type:'multi_numeric', mark:2, items:'[{"label":"x","answer":3,"tolerance":0},{"label":"y","answer":2,"tolerance":0}]' }, // 4
  { question:'Rows', type:'matrix', mark:2, accept:'True|False', items:'[{"statement":"A","answer":"True"},{"statement":"B","answer":"False"}]' },   // 5
  { question:'2+2?', type:'mcq', options:['3','4','5','6'], answer:'B', mark:1 } // 6: binary regression
];
await db.query(`insert into cbt_exams(id,code,title,class,csv_data,questions)values($1,'ADV1',$2,'JSS 1',$3,$3)`,[exam,'Advanced',JSON.stringify(bank)]);

const answers = [
  { index:0, answer:['Sodium','Potassium','Calcium'] },   // 2/3 right
  { index:1, answer:['Mercury','Earth','Venus','Mars'] }, // 2/4 in place
  { index:2, answer:['4','10'] },                          // 2/2, no bad picks
  { index:3, answer:['acceleration','g'] },                // 2/2 (alt accepted)
  { index:4, answer:['3','9'] },                           // 1/2 parts
  { index:5, answer:['True','True'] },                     // 1/2 rows
  { index:6, answer:'B' }                                  // correct
];
const out = (await db.query(`select public.cbt_submit_v5($1::jsonb) d`,[JSON.stringify({exam_id:exam,student_name:'Adv Student',student_class:'JSS 1',client_ref:'adv-1',answers_data:answers})])).rows[0].d;
if (!out.saved) throw Error('submit failed: '+JSON.stringify(out));
// expected: 3*(2/3)=2 + 4*(2/4)=2 + 2 + 2 + 2*(1/2)=1 + 2*(1/2)=1 + 1 = 11 of 16
if (Number(out.total)!==16) throw Error('total wrong: '+out.total);
if (Math.abs(Number(out.score)-11)>0.01) throw Error('partial-credit score wrong: '+out.score+' (expected 11)');
if (out.error==='answer_key_missing') throw Error('structured Items not accepted as key');
if (!String(out.engine_version).startsWith('v5.1')) throw Error('engine marker regression: '+out.engine_version);

// fully correct paper still scores 100%
const perfect = [
  { index:0, answer:['Sodium','Potassium','Iron'] },
  { index:1, answer:['Mercury','Venus','Earth','Mars'] },
  { index:2, answer:['4','10'] },
  { index:3, answer:['a','g'] },
  { index:4, answer:['3','2'] },
  { index:5, answer:['True','False'] },
  { index:6, answer:'4' }
];
const out2 = (await db.query(`select public.cbt_submit_v5($1::jsonb) d`,[JSON.stringify({exam_id:exam,student_name:'Perfect',student_class:'JSS 1',client_ref:'adv-2',answers_data:perfect})])).rows[0].d;
if (Number(out2.percent)!==100 || out2.correct_count!==7) throw Error('perfect paper failed: '+JSON.stringify(out2));

// regrade path uses the same engine
const rg = (await db.query(`select public.cbt_regrade_exam_results_v5($1) d`,[exam])).rows[0].d;
if (!rg.ok || rg.regraded_count!==2) throw Error('regrade failed: '+JSON.stringify(rg));
const kept = (await db.query(`select score,percent from cbt_results where client_ref='adv-1'`)).rows[0];
if (Math.abs(Number(kept.score)-11)>0.01) throw Error('regrade changed the partial score: '+JSON.stringify(kept));

/* ---- 4. Fee override honoured (issue 4) ---- */
const fs0 = (await db.query(`select public.sc_student_fee_state($1) f`,[student])).rows[0].f;
if (!fs0.ok || Number(fs0.bill)!==200000 || fs0.override) throw Error('baseline fee state wrong: '+JSON.stringify(fs0));
await db.query(`insert into fee_payments(student_id,student_name,amount_paid,fee_total,term,session,total_overridden)values($1,'Fee Student',50000,150000,'Third Term','2025/2026',true)`,[student]);
const fs1 = (await db.query(`select public.sc_student_fee_state($1) f`,[student])).rows[0].f;
if (!fs1.override) throw Error('override flag not honoured: '+JSON.stringify(fs1));
if (Number(fs1.bill)!==150000) throw Error('override bill wrong: '+fs1.bill);
if (Number(fs1.paid)!==50000 || Number(fs1.total_due)!==100000) throw Error('override total due wrong: '+JSON.stringify({paid:fs1.paid,due:fs1.total_due}));
// a normal (non-overridden) payment must NOT trigger the override path
await db.query(`update fee_payments set total_overridden=false`);
const fs2 = (await db.query(`select public.sc_student_fee_state($1) f`,[student])).rows[0].f;
if (fs2.override || Number(fs2.bill)!==200000) throw Error('non-override regression: '+JSON.stringify(fs2));

console.log(JSON.stringify({ok:true,
  sanitised:{matching_pool:pubMatch.pool.length,ordering_alphabetical:true,hot_text_flags_stripped:true,cloze_blanks:pubCloze.blanks},
  partial_credit:{score:out.score,total:out.total,expected:11},
  perfect:{percent:out2.percent},
  regrade:{count:rg.regraded_count,stable:true},
  fee_override:{bill:fs1.bill,total_due:fs1.total_due,revert_ok:true}
},null,2));
await db.close();
