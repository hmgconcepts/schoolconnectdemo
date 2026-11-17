/* Round 18 item 13 — "a teacher clicks Edit on a pre-existing CBT and nothing
   happens". Root cause: the Assessment-type dropdown was built with
   ['exam',…] + (CBTUI._purposes||[]).map(…), and Array + Array concatenates
   to a STRING, so the following .map() threw. edit() is async, so the
   rejection was swallowed and the modal never opened.
   This test boots the real cbt.html in a browser and clicks Edit. */
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = process.argv[2] || '/home/user/repos/gosaportal'; // a CLIENT repo: the generator's config.js has no `var sb`
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p === '/') p = '/cbt.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('nf'); }
  rs.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise(r => srv.listen(0, '0.0.0.0', r));
const base = 'http://127.0.0.1:' + srv.address().port;

const STUB = `
window.supabase = { createClient: () => {
  const rows = { cbt_exams: [{ id:'E1', code:'CBT-001', title:'First Term Physics', subject:'Physics', class:'JSS 1', term:'First Term', session:'2025/2026', assessment_type:'exam', duration_min:45, max_score:40, teacher_id:null }],
                 assessment_columns: [] };
  const mk = (t) => { const st={f:[]};
    const c={ select:()=>c, order:()=>c, limit:()=>c, range:()=>c, eq:(k,v)=>{st.f.push([k,v]);return c;},
      in:()=>c, ilike:()=>c, neq:()=>c, gte:()=>c, lte:()=>c, is:()=>c, not:()=>c, match:()=>c,
      or:()=>c, filter:()=>c, abortSignal:()=>c, returns:()=>c, csv:()=>c, count:()=>c, head:()=>c,
      maybeSingle:async()=>({ data:(rows[t]||[]).filter(x=>st.f.every(([k,v])=>String(x[k])===String(v)))[0]||null, error:null }),
      single:async()=>({ data:(rows[t]||[]).filter(x=>st.f.every(([k,v])=>String(x[k])===String(v)))[0]||null, error:null }),
      then:(res)=>Promise.resolve(res({ data:(rows[t]||[]).filter(x=>st.f.every(([k,v])=>String(x[k])===String(v))), error:null })),
      insert:async()=>({data:null,error:null}), update:()=>c, delete:()=>c, upsert:async()=>({data:null,error:null}) };
    return c; };
  return { from: mk, auth:{ getSession:async()=>({data:{session:null}}), getUser:async()=>({data:{user:null}}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>({}) },
    rpc:async()=>({data:null,error:null}), storage:{from:()=>({upload:async()=>({}),getPublicUrl:()=>({data:{publicUrl:''}})})},
    channel:()=>({on(){return this;},subscribe(){return this;}}) };
}};`;

const b = await chromium.launch({ args: ['--no-sandbox'] });
/* V12.76 — the service worker was the reason this harness was not hermetic:
   it precaches assets/vendor/supabase-js-… itself, that fetch does NOT go
   through page.route(), and the cached REAL library then replaced the stub —
   so the page talked to the school's live Supabase project. Blocking the
   worker makes every byte the page runs come from this file. */
const ctx = await b.newContext({ serviceWorkers: 'block' });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
/* V12.76 — the library is vendored, so it is served from ./assets/vendor/. Stub both
   spellings: the local file (every page now) and the CDN (any page not yet rewritten). */
/* V12.76 — HERMETIC. This harness used to stub only two URL patterns and let
   everything else through, so on a machine with internet the page under test
   could reach the school's REAL Supabase project (it did — the run failed with
   a live `invalid input syntax for type uuid`, which is a server error, not a
   stub's). A test that can touch production data is not a test. Every request is
   now answered locally: the files from the repo, the library from the stub,
   anything else with an empty JSON body. */
const LOCAL = base + '/';
await pg.route('**/*', route => {
  const u = route.request().url();
  /* the vendored library is a LOCAL file, so it must be tested for BEFORE the
     "serve it from the repo" rule — otherwise the real 134 KB client loads and
     the harness silently depends on the network (which is precisely what it did) */
  if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  if (u.startsWith(LOCAL)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await pg.addInitScript(() => { try {
  localStorage.setItem('sc-cached-profile', JSON.stringify({ id: 'T1', role: 'teacher', full_name: 'Teacher One', email: 't1@school.ng', status: 'approved' }));
} catch (e) {} });
await pg.goto(base + '/cbt.html', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  window.App = window.App || {}; App.currentRole = 'teacher';
  window.SC_PROFILE = { role: 'teacher', id: 'T1' };
  let opened = null;
  window.openModal = function (t, body) { opened = { title: t, len: (body || '').length, html: body || '' }; };
  // register a custom purpose BEFORE opening, so the dropdown must offer it,
  // and a duplicate of a built-in, so de-duplication is exercised
  CBTUI._purposes = [{ slug: 'midterm' }, { slug: 'spelling-bee' }];
  /* a toast is how this page reports a failure it swallows — capture it, so a
     silently-refused click can never look like a passing test */
  let err = null; window.__toasts = [];
  window.toast = function (m) { window.__toasts.push(String(m).slice(0, 140)); };
  try { await window.CBTUI.edit('E1'); } catch (e) { err = e.message; }
  const list = CBTUI._purposeList();
  const dd = opened ? (opened.html.match(/id="ed-type"[\s\S]*?<\/select>/) || [''])[0] : '';
  return {
    opened: !!opened, title: opened && opened.title, len: opened && opened.len, err,
    toasts: window.__toasts,
    list, dropdownHasSpelling: dd.includes('spelling-bee'),
    dropdownBuiltins: ['exam','midterm','assignment','project','quiz','practical','prep'].filter(x => dd.includes('value="' + x + '"')),
  };
});
await b.close(); srv.close();

const fails = [];
if (!out.opened) fails.push('clicking Edit did not open the editor' + (out.err ? ' — ' + out.err
  : out.toasts.length ? ' — the page reported: ' + JSON.stringify(out.toasts) : ''));
if (out.err) fails.push('edit() threw: ' + out.err);
if (out.list.filter(x => x === 'midterm').length !== 1) fails.push('purpose list is not de-duplicated: ' + JSON.stringify(out.list));
if (!out.list.includes('spelling-bee')) fails.push('custom purpose slug dropped');
if (out.dropdownBuiltins.length !== 7) fails.push('dropdown is missing built-in purposes: ' + JSON.stringify(out.dropdownBuiltins));
if (!out.dropdownHasSpelling) fails.push('dropdown does not offer the custom purpose');

console.log(JSON.stringify({ title: out.title, len: out.len, list: out.list, builtins: out.dropdownBuiltins, custom: out.dropdownHasSpelling, toasts: out.toasts }, null, 1));
console.log('pageerrors:', errs.length);
if (fails.length) { console.error('\nCBT EDIT FAILED:\n' + fails.join('\n')); process.exit(1); }
console.log('\nCBT EDIT OK — Edit opens the full editor; every purpose is offered once.');
