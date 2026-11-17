/* Regression: the ID card front and back must ALWAYS be the same size and
   orientation (Round 18, items 1 & 5). Guards against Super.idcard.pairHtml
   silently dropping its opts argument, and against any template hardcoding a
   width. Fails loudly if a future edit reintroduces the mismatch. */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const ROOT = process.argv[2] || '/home/user/repos/schoolconnect';
const srv = (await import('http')).createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><html><body></body></html>'); });
await new Promise(r => srv.listen(0, '0.0.0.0', r));
const b = await chromium.launch({ args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 2000, height: 1600 } });
await pg.goto('http://127.0.0.1:' + srv.address().port + '/');
await pg.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'assets/js/super.js'), 'utf8') });

const out = await pg.evaluate(() => {
  window.Super.school = window.Super.school || { name: 'GoSA', primary: '#0506ae', accent: '#964eec' };
  const cards = (html) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:-99999px;top:0;width:3000px';
    d.innerHTML = html; document.body.appendChild(d);
    /* V12.75 — the physical card is the FACE, not whatever element a template
       happens to draw its content on. Both faces are now emitted as
       [data-face], so this measures the thing that is actually printed. */
    const faces = [...d.querySelectorAll('[data-face]')];
    const r = (faces.length ? faces : [...d.querySelectorAll('.sc-idcard')])
      .map(e => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; });
    d.remove(); return r;
  };
  const base = { full_name: 'Ada Obi', admission_no: 'GOSA/2024/001', class: 'JSS 1', type: 'student' };
  const sizes = [['landscape ID-1', 85.6, 53.98], ['portrait ID-1', 53.98, 85.6], ['ID-2 landscape', 105, 74], ['custom portrait', 60, 95]];
  const tpls = ['horizontal', 'premium', 'vertical', 'badge'];
  const fails = [];
  let checked = 0;
  for (const [name, w, h] of sizes) for (const tpl of tpls) {
    const opts = { widthMm: w, heightMm: h, widthPx: Math.round(w * 96 / 25.4), heightPx: Math.round(h * 96 / 25.4), template: tpl };
    const p = { ...base, template: tpl };
    const pair = cards(Super.idcard.pairHtml(p, opts));
    checked++;
    if (pair.length !== 2) { fails.push(`${name}/${tpl}: expected 2 faces, got ${pair.length}`); continue; }
    if (pair[0].w !== pair[1].w || pair[0].h !== pair[1].h) fails.push(`${name}/${tpl}: front ${pair[0].w}x${pair[0].h} != back ${pair[1].w}x${pair[1].h}`);
    // orientation must agree with the requested one
    const wantPortrait = h > w;
    if ((pair[0].h > pair[0].w) !== wantPortrait) fails.push(`${name}/${tpl}: orientation wrong (front ${pair[0].w}x${pair[0].h}, want ${wantPortrait ? 'portrait' : 'landscape'})`);
    // and must equal the true mm size at 96dpi
    const ew = Math.round(w * 96 / 25.4), eh = Math.round(h * 96 / 25.4);
    if (Math.abs(pair[0].w - ew) > 1 || Math.abs(pair[0].h - eh) > 1) fails.push(`${name}/${tpl}: front ${pair[0].w}x${pair[0].h} != requested ${ew}x${eh}`);
  }
  return { checked, fails };
});
await b.close(); srv.close();
if (out.fails.length) { console.error('ID CARD PARITY FAILED (' + out.fails.length + ' of ' + out.checked + ')\n' + out.fails.join('\n')); process.exit(1); }
console.log(`ID CARD PARITY OK — ${out.checked}/${out.checked} size x template combinations render front and back identically.`);
