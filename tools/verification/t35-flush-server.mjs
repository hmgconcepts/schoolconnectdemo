/* Round 18 item 10 — "clicking Flush now on ☁️ Stranded on SERVER did nothing
   and showed no message". The tile called CBTUI.flushServer() behind an && guard
   but the method was never written, so the click vanished silently.
   This proves the method exists and that every outcome produces feedback. */
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = process.argv[2] || '/home/user/repos/gosaportal';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };
const srv = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p === '/') p = '/cbt.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('nf'); }
  rs.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise(r => srv.listen(0, '0.0.0.0', r));
const base = 'http://127.0.0.1:' + srv.address().port;

/* rpc replies are driven by window.__rpc; everything else returns empty. */
const STUB = `
window.__rpc = null;
window.supabase = { createClient: () => {
  const mk = (t) => { const c={ select:()=>c, order:()=>c, limit:()=>c, range:()=>c, eq:()=>c, in:()=>c,
      ilike:()=>c, neq:()=>c, gte:()=>c, lte:()=>c, is:()=>c, not:()=>c, match:()=>c, or:()=>c,
      filter:()=>c, abortSignal:()=>c, returns:()=>c, csv:()=>c, count:()=>c, head:()=>c,
      maybeSingle:async()=>({data:null,error:null}), single:async()=>({data:null,error:null}),
      then:(res)=>Promise.resolve(res({data:[],error:null})),
      insert:async()=>({data:null,error:null}), update:()=>c, delete:()=>c, upsert:async()=>({data:null,error:null}) };
    return c; };
  return { from: mk,
    rpc: async (name, args) => (window.__rpc ? window.__rpc(name, args) : { data: null, error: null }),
    auth:{ getSession:async()=>({data:{session:null}}), getUser:async()=>({data:{user:null}}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>({}) },
    storage:{from:()=>({upload:async()=>({}),getPublicUrl:()=>({data:{publicUrl:''}})})},
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
/* V12.76 — HERMETIC (see t34): nothing leaves the sandbox. */
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
await pg.route('**/supabase.co/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { try {
  localStorage.setItem('sc-cached-profile', JSON.stringify({ id:'T1', role:'admin', full_name:'Admin One', email:'a@school.ng', status:'approved' }));
} catch (e) {} });
await pg.goto(base + '/cbt.html', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(2500);

async function run(reply, discard) {
  return pg.evaluate(async ({ reply, discard }) => {
    window.__modal = null; window.__toasts = [];
    window.openModal = (t, body, footer) => { window.__modal = { title: t, body: body || '', footer: footer || '' }; };
    window.closeModal = () => {};
    window.toast = (m, kind) => { window.__toasts.push({ m, kind }); };
    window.confirm = () => true;
    window.__rpc = (name) => {
      if (name === 'cbt_flush_all_pending_server') return reply.stubMissing ? { data: null, error: { message: 'Could not find the function public.cbt_flush_all_pending_server' } } : { data: reply.data, error: null };
      if (name === 'cbt_audit_all_missing') return { data: { ok: true, exams: reply.exams || [] }, error: null };
      if (name === 'cbt_flush_pending_server') return { data: { ok: true, saved: 1, failed: 0 }, error: null };
      return { data: null, error: null };
    };
    let threw = null;
    try { await CBTUI.flushServer(discard); } catch (e) { threw = e.message; }
    return { threw, modal: window.__modal, toasts: window.__toasts };
  }, { reply, discard });
}

const has = await pg.evaluate(() => typeof (window.CBTUI || {}).flushServer);
console.log('CBTUI.flushServer is', has);

// A) nothing stranded — must still answer
const a = await run({ data: { ok: true, saved: 0, failed: 0, discarded: 0, orphan_count: 0, stranded_after: 0 } });

// B) mixed outcome — must open a table and offer the discard
const bres = await run({ data: { ok: true, saved: 2, failed: 1, discarded: 0, orphan_count: 1, stranded_after: 2,
  errors: ['STU-01: duplicate result already saved'], orphaned: [{ client_ref: 'STU-09', why: 'the exam this submission belongs to no longer exists' }] } });

// C) older database — must fall back and explain
const c = await run({ stubMissing: true, exams: [{ id: 'E1', code: 'CBT-1', pending_server: 3 }] });

// D) discard path
const d = await run({ data: { ok: true, saved: 0, failed: 0, discarded: 1, orphan_count: 1, stranded_after: 0,
  errors: [], orphaned: [{ client_ref: 'STU-09', why: 'the exam this submission belongs to no longer exists' }] } }, true);

await b.close(); srv.close();

const fails = [];
if (has !== 'function') fails.push('CBTUI.flushServer is not a function (' + has + ') — the button would do nothing');
if (a.threw) fails.push('flush threw with nothing stranded: ' + a.threw);
if (!a.toasts.length) fails.push('nothing stranded produced NO feedback at all');
if (a.toasts.length && !/nothing is stranded/i.test(a.toasts[0].m)) fails.push('nothing-stranded message unclear: ' + JSON.stringify(a.toasts[0]));
if (bres.threw) fails.push('flush threw on a mixed outcome: ' + bres.threw);
if (!bres.modal) fails.push('mixed outcome opened no popup');
else {
  if (!/2 saved/.test(bres.modal.title)) fails.push('popup title does not report saved count: ' + bres.modal.title);
  if (!/1 failed/.test(bres.modal.title)) fails.push('popup title does not report the failure: ' + bres.modal.title);
  if (!/STU-01/.test(bres.modal.body)) fails.push('failed row is not named on screen');
  if (!/STU-09/.test(bres.modal.body)) fails.push('orphaned row is not named on screen');
  if (!/Discard 1 unrecoverable/.test(bres.modal.footer)) fails.push('no way to discard the unrecoverable row');
}
if (c.threw) fails.push('legacy fallback threw: ' + c.threw);
if (!c.modal) fails.push('older database produced no popup explanation');
else if (!/complete-schema\.sql/.test(c.modal.body)) fails.push('legacy popup does not say how to finish');
if (d.threw) fails.push('discard path threw: ' + d.threw);
if (!d.toasts.length) fails.push('discard path produced no feedback');

console.log(JSON.stringify({ a: a.toasts, b: bres.modal && bres.modal.title, c: c.modal && c.modal.title, d: d.toasts }, null, 1));
console.log('pageerrors:', errs.length);
if (fails.length) { console.error('\nFLUSH SERVER FAILED:\n' + fails.join('\n')); process.exit(1); }
console.log('\nFLUSH SERVER OK — the button exists and every outcome reports back.');
