/* Round 18 item 14 — REGRESSION: real report sheets for one class must print
   DIFFERENT positions. Guards the RANK-01 defect where loadContext() pre-
   filtered rows to the single learner, making the ranking cohort a cohort of
   one and printing "1st" on every sheet in the school.
   Renders the actual sheets through ReportEngine.renderStudent(). */
import { chromium } from 'playwright-core';
import fs from 'fs';
const ROOT = process.argv[2] || '/home/user/repos/schoolconnect';

const srv = (await import('http')).createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<html><body></body></html>'); });
await new Promise(r => srv.listen(0, '0.0.0.0', r));
const b = await chromium.launch({ args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.goto('http://127.0.0.1:' + srv.address().port + '/');
await pg.addScriptTag({ content: fs.readFileSync(ROOT + '/assets/js/report-engine.js', 'utf8') });

const out = await pg.evaluate(async () => {
  const RE = window.ReportEngine || window.SCReportEngine;
  const subjects = ['Mathematics', 'English', 'Basic Science', 'Social Studies'];
  const people = [
    ['Ada Obi', 's1', [90, 92, 88, 94]],
    ['Bola Ade', 's2', [70, 72, 68, 74]],
    ['Chidi Eze', 's3', [55, 50, 58, 52]],
    ['Dayo Bal', 's4', [30, 28, 32, 26]],
  ];
  const results = [], students = [];
  people.forEach(([n, id, sc]) => {
    students.push({ id, full_name: n, admission_no: 'ADM/' + id, class: 'JSS 1' });
    sc.forEach((t, i) => results.push({ student_id: id, student_name: n, class: 'JSS 1', subject: subjects[i], total: t, max: 100, term: 'First Term', session: '2025/2026' }));
  });
  const tables = { results, students, school_settings: [{ id: 1, name: 'Test School', address: 'Lagos', phone: '1', email: 'a@b.c', motto: 'Learn', logoExt: 'svg' }] };
  function q(t) {
    let d = (tables[t] || []).slice();
    const a = { select: () => a, eq: (c, v) => { d = d.filter(r => String(r[c]) === String(v)); return a; }, in: (c, vs) => { d = d.filter(r => vs.map(String).includes(String(r[c]))); return a; }, ilike: () => a, order: () => a, limit: () => a, single: async () => ({ data: d[0] || null, error: null }), maybeSingle: async () => ({ data: d[0] || null, error: null }), then: res => Promise.resolve(res({ data: d, error: null })), insert: async () => ({ data: null, error: null }), update: () => a, upsert: async () => ({ data: null, error: null }), delete: () => a };
    return a;
  }
  const sb = { from: q, rpc: async () => ({ data: null, error: null }) };
  RE.init(sb); window.sb = sb;
  const got = [];
  for (const [name] of people) {
    const html = String(await RE.renderStudent({ class: 'JSS 1', term: 'First Term', session: '2025/2026', student: name, report_kind: 'terminal' }) || '');
    const m = html.match(/\b(\d+)(st|nd|rd|th)\b/);
    got.push({ name, position: m ? m[0] : null, htmlLen: html.length });
  }
  return got;
});
await b.close(); srv.close();

const want = { 'Ada Obi': '1st', 'Bola Ade': '2nd', 'Chidi Eze': '3rd', 'Dayo Bal': '4th' };
const fails = [];
for (const r of out) {
  if (r.htmlLen < 1000) fails.push(`${r.name}: sheet not generated (len ${r.htmlLen})`);
  else if (r.position !== want[r.name]) fails.push(`${r.name}: expected ${want[r.name]}, sheet shows ${r.position}`);
}
const seen = out.map(r => r.position);
if (new Set(seen).size === 1) fails.push(`all sheets show "${seen[0]}" — the everyone-is-First bug is back`);
console.log(out.map(r => `  ${r.name.padEnd(12)} ${r.position}`).join('\n'));
if (fails.length) { console.error('\nREPORT POSITIONS FAILED:\n' + fails.join('\n')); process.exit(1); }
console.log('REPORT POSITIONS OK — four learners, four different printed positions.');
