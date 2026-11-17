/* Round 18 item 11 — deleting a term must remove it from BOTH stores so it
   stops appearing in the platform's term dropdowns. */
import { chromium } from 'playwright-core';
import fs from 'fs';
const ROOT = process.argv[2] || '/home/user/repos/schoolconnect';
const page = fs.readFileSync(ROOT + '/academic_setup.html', 'utf8');
// pull the AS object's script out of the page
const scripts = [...page.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const asScript = scripts.find(s => s.includes('addLookup') && s.includes('async del'));
if (!asScript) { console.error('AS script not found'); process.exit(1); }

const srv = (await import('http')).createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<html><body></body></html>'); });
await new Promise(r => srv.listen(0, '0.0.0.0', r));
const b = await chromium.launch({ args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.goto('http://127.0.0.1:' + srv.address().port + '/');

const out = await pg.evaluate(async (script) => {
  // --- fake store -------------------------------------------------------
  let lookups = [{ id: 'L1', kind: 'term', value: 'Fourth Term', position: 0 },
                 { id: 'L2', kind: 'term', value: 'First Term', position: 0 },
                 { id: 'L3', kind: 'session', value: '2025/2026', position: 0 }];
  let periods = [{ id: 'P1', term: 'Fourth Term', session: '2030/2031' },
                 { id: 'P2', term: 'First Term', session: '2025/2026' }];
  const store = { lookups, academic_periods: periods };
  function q(t) {
    // faithful PostgREST: select().eq() filters, delete().eq().select() deletes
    const mk = (filters) => {
      const d = {
        eq: (c, v) => { filters.push([c, v]); return d; },
        select: async () => {
          const before = store[t].length;
          store[t] = store[t].filter(r => !filters.every(([c, v]) => String(r[c]) === String(v)));
          const removed = before - store[t].length;
          return { data: Array.from({ length: removed }, () => ({ id: 'x' })), error: null };
        }
      };
      return d;
    };
    const api = {
      select: () => {
        let f = [];
        const s = {
          eq: (c, v) => { f.push([c, v]); return s; },
          order: () => s, limit: () => s, neq: () => s, in: () => s,
          single: async () => ({ data: null, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (res) => Promise.resolve(res({ data: (store[t] || []).filter(r => f.every(([c, v]) => String(r[c]) === String(v))), error: null })),
        };
        return s;
      },
      order: () => api, limit: () => api, neq: () => api, in: () => api,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res) => Promise.resolve(res({ data: (store[t] || []).slice(), error: null })),
      delete: () => mk([]),
      insert: async () => ({ data: null, error: null }),
      update: () => api, upsert: async () => ({ data: null, error: null }),
    };
    return api;
  }
  window.sb = { from: q, rpc: async () => ({ data: null, error: null }) };
  window.toast = (m) => { window.__toasts = (window.__toasts || []).concat([m]); };
  window.esc = (s) => String(s == null ? '' : s);
  window.confirm = () => true;
  window.sessionStorage.clear && 0;
  // minimal DOM the AS object touches
  document.body.innerHTML = '<div id="as-depts"></div><div id="as-lookups"></div><div id="as-periods"></div><select id="as-p-session"></select><select id="as-p-term"></select>';
  eval(script);
  // hydrate _lastRows the way list() would
  const ASref = window.AS || eval('typeof AS!=="undefined"?AS:null');
  if (!ASref) throw new Error('AS not defined');
  ASref._lastRows = { lookups: store.lookups.slice(), academic_periods: store.academic_periods.slice() };
  // delete the term lookup L1 ("Fourth Term")
  await ASref.del('lookups', 'L1');
  const afterLookupDelete = { lookups: store.lookups.map(r => r.value + '/' + r.kind), periods: store.academic_periods.map(r => r.term) };
  // now delete a period and confirm the orphaned lookup is cleaned too
  store.lookups.push({ id: 'L9', kind: 'term', value: 'Second Term', position: 0 });
  store.academic_periods.push({ id: 'P9', term: 'Second Term', session: '2027/2028' });
  ASref._lastRows = { lookups: store.lookups.slice(), academic_periods: store.academic_periods.slice() };
  await ASref.del('academic_periods', 'P9');
  const afterPeriodDelete = { lookups: store.lookups.map(r => r.value + '/' + r.kind), periods: store.academic_periods.map(r => r.term) };
  return { afterLookupDelete, afterPeriodDelete, toasts: window.__toasts || [] };
}, asScript);
await b.close(); srv.close();

const fails = [];
if (out.afterLookupDelete.lookups.some(v => v.startsWith('Fourth Term'))) fails.push('lookup "Fourth Term" still present');
if (out.afterLookupDelete.periods.includes('Fourth Term')) fails.push('academic_periods still holds "Fourth Term" — it would still show in dropdowns');
if (out.afterPeriodDelete.lookups.some(v => v.startsWith('Second Term'))) fails.push('deleting the period left the "Second Term" lookup behind');
if (out.afterPeriodDelete.periods.includes('Second Term')) fails.push('"Second Term" period survived');
console.log(JSON.stringify(out, null, 2));
if (fails.length) { console.error('\nTERM DELETE FAILED:\n' + fails.join('\n')); process.exit(1); }
console.log('\nTERM DELETE OK — term removed from both stores in either direction.');
