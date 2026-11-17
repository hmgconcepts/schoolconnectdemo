/* Round 18 item 2 — "there is no page where prep exam results can be generated
   like midterm reports; it is not showing".
   Two real defects: (a) nothing in the platform linked to prep-exam-reports.html,
   (b) the page called sc_prep_generate(...,p_dry_run) but the function had three
   arguments and returned a different shape, so generate/repair failed.
   This proves the function now serves the page's contract. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { schemaText } from './schema-loader.mjs';
const H = new URL('.', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : (fail++, console.log('  FAIL ' + m, x === undefined ? '' : JSON.stringify(x))); };

const db = await PGlite.create();
await db.exec(fs.readFileSync(H + 'pglite-boot.sql', 'utf8'));
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
await db.exec(schemaText(H + '../../database/complete-schema.sql'));
const q = async s => (await db.query(s)).rows;
const one = async s => (await q(s))[0];
const STAFF = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users(id,email) values('${STAFF}','t@x.t') on conflict do nothing;
  insert into profiles(id,full_name,role,status) values('${STAFF}','Tutor','teacher','approved')
    on conflict(id) do update set role='teacher',status='approved';`);
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [STAFF]);
await db.exec(`insert into classes(name) values('JSS 1A') on conflict do nothing;
  insert into academic_periods(session,term,is_current) values('2026/2027','First Term',true) on conflict do nothing;
  insert into students(full_name,admission_no,class) values('Ada Obi','ADM001','JSS 1A') on conflict do nothing;
  insert into students(full_name,admission_no,class) values('Bola Ade','ADM002','JSS 1A') on conflict do nothing;`);

/* the page's dry-run call — 4 arguments; this used to be "function does not exist" */
const dry = await one(`select public.sc_prep_generate('JSS 1A','First Term','2026/2027',true) r`);
ok(dry.r.ok === true, 'DRY RUN call succeeds (4th argument accepted)', dry.r);
ok(dry.r.dry_run === true, 'dry run is flagged as a dry run', dry.r.dry_run);
ok(Number(dry.r.generated) === 0, 'a dry run writes nothing', dry.r.generated);

/* the page's normal call — 3 arguments must still work (default) */
const gen = await one(`select public.sc_prep_generate('JSS 1A','First Term','2026/2027') r`);
ok(gen.r.ok === true, 'the 3-argument generate call still works', gen.r);
ok(Number(gen.r.generated) === 2, 'it reports the learners it generated for', gen.r.generated);
ok(typeof gen.r.with_scores === 'number' && typeof gen.r.without_scores === 'number', 'the page\'s with/without score counters exist', gen.r);
ok(gen.r.with_scores + gen.r.without_scores === 2, 'with+without adds up to the class size', gen.r);
ok(/No prep marks/.test(String(gen.r.warning || gen.r.note || '')), 'an empty class is explained, not silently zero', gen.r.warning || gen.r.note);

/* once prep marks exist, the counters must move */
await db.exec(`insert into prep_scores(student_id_ref,student_name,class,subject,term,session,score,max_mark)
  values('ADM001','Ada Obi','JSS 1A','Physics','First Term','2026/2027',40,50)`);
const gen2 = await one(`select public.sc_prep_generate('JSS 1A','First Term','2026/2027') r`);
ok(Number(gen2.r.with_scores) === 1, 'a learner with prep marks is counted WITH scores', gen2.r.with_scores);
ok(Number(gen2.r.without_scores) === 1, 'the learner without marks is counted WITHOUT', gen2.r.without_scores);
ok(Number(gen2.r.prep_marks) === 1, 'the prep mark count is real', gen2.r.prep_marks);

/* non-staff must be refused */
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, ['33333333-3333-3333-3333-333333333333']);
const denied = await one(`select public.sc_prep_generate('JSS 1A','First Term','2026/2027') r`);
ok(denied.r.ok === false, 'an anonymous caller cannot generate prep reports', denied.r);

/* the page's Publish-all call — it passed p_term/p_session/p_publish/p_generate,
   none of which the function had, so publishing silently did nothing. */
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [STAFF]);
await db.exec(`update profiles set role='principal' where id='${STAFF}'`);
const pub = await one(`select public.sc_prep_publish_all(true,'First Term','2026/2027',true,true) r`);
ok(pub.r.ok === true, 'PUBLISH ALL accepts the page\'s argument names', pub.r);
ok(Number(pub.r.updated) >= 1, 'it published the prep cards in scope', pub.r);
const pubd = await one(`select count(*) n from prep_report_cards where published is true`);
ok(Number(pubd.n) >= 1, 'the cards really are published', pubd);
/* and the term/session scope is honoured */
const pub2 = await one(`select public.sc_prep_publish_all(false,'Second Term','2099/2100',false,false) r`);
ok(Number(pub2.r.updated) === 0, 'a term with no cards publishes nothing', pub2.r);

console.log(`prep results: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
