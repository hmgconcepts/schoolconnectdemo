/* Round 18 item 12 — the "Withhold the position for one learner" Class dropdown
   must be populated with the school's real classes and must respond. */
import { chromium } from 'playwright-core';
import fs from 'fs';
const ROOT = process.argv[2] || '/home/user/repos/schoolconnect';
const srv = (await import('http')).createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<html><body></body></html>'); });
await new Promise(r => srv.listen(0, '0.0.0.0', r));
const b = await chromium.launch({ args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.goto('http://127.0.0.1:' + srv.address().port + '/');
const html = fs.readFileSync(ROOT + '/report-cards.html', 'utf8');
// mount just the panel markup the page ships
const m = html.match(/<details[\s\S]{0,900}?Withhold the position for one learner[\s\S]*?<\/details>/);
await pg.evaluate((markup) => { document.body.innerHTML = markup + '<div id="pol-preview"></div>'; }, m ? m[0] : '<select id="pol-class"><option value="">All classes</option></select><div id="pol-preview"></div>');

await pg.addScriptTag({ content: fs.readFileSync(ROOT + '/assets/js/report-engine.js', 'utf8') });
const out = await pg.evaluate(async () => {
  const students = [
    { id: 'u1', full_name: 'Ada Obi', class: 'JSS 1', admission_no: 'A1' },
    { id: 'u2', full_name: 'Bola Ade', class: 'JSS 2', admission_no: 'A2' },
    { id: 'u3', full_name: 'Chidi Eze', class: 'JSS 1', admission_no: 'A3' },
  ];
  function q(t) {
    let d = ({ students, academic_periods: [{ term: 'First Term', session: '2025/2026', class: 'JSS 1' }], sc_report_position_hold: [] }[t] || []).slice();
    const a = { select: () => a, eq: (c, v) => { d = d.filter(r => String(r[c]) === String(v)); return a; }, in: () => a, ilike: () => a, order: () => a, limit: () => a, single: async () => ({ data: d[0] || null, error: null }), maybeSingle: async () => ({ data: d[0] || null, error: null }), then: res => Promise.resolve(res({ data: d, error: null })), insert: async () => ({ data: null, error: null }), update: () => a, upsert: async () => ({ data: null, error: null }), delete: () => a };
    return a;
  }
  const sb = { from: q, rpc: async () => ({ data: null, error: null }) };
  window.sb = sb;
  if (window.ReportEngine) window.ReportEngine.sb = sb;
  await ReportPolicy.initAll();
  const el = document.getElementById('pol-class');
  const opts = [...el.options].map(o => o.value);
  // now choose JSS 1 and confirm the learner list narrows
  el.value = 'JSS 1';
  await ReportPolicy.openHolds();
  const rows = document.querySelectorAll('#pol-preview tbody tr').length;
  const names = [...document.querySelectorAll('#pol-preview tbody tr b')].map(b => b.textContent);
  return { options: opts, learnersShown: rows, names };
});
await b.close(); srv.close();
const fails = [];
if (!out.options.includes('JSS 1') || !out.options.includes('JSS 2')) fails.push('class dropdown was not populated: ' + JSON.stringify(out.options));
if (out.learnersShown !== 2) fails.push(`filtering by JSS 1 showed ${out.learnersShown} learners, expected 2`);
console.log(JSON.stringify(out, null, 2));
if (fails.length) { console.error('\nPOL-CLASS FAILED:\n' + fails.join('\n')); process.exit(1); }
console.log('\nPOL-CLASS OK — dropdown lists JSS 1 / JSS 2 and filters the learner list.');
