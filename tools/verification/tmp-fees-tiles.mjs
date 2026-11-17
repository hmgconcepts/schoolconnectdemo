#!/usr/bin/env node
/* V12.69 — the Fees page headline tiles, proved against the file that ships.
 *
 * This runs the tile block *as written in fees.html* (extracted by anchor, not
 * retyped) and checks the four states a bursar actually sees:
 *
 *   A  the round-12 screenshot case  bill 28,100 / paid 20,000 / arrears 3,000
 *   B  an opening balance entered     (criterion 1 and 4 of the round-12 brief)
 *   C  nothing owing at all           (criterion 1: the line must not appear)
 *   D  the class fee is not published (a bill must never read ₦0 when unknown)
 *
 * The bug this exists to catch: the conditional opening tile used to be
 * concatenated as a ternary and then `.map`ped, which only mapped the final
 * array literal — the opening tile rendered as raw "label,value,colour" text
 * instead of a tile. Every other number was right, so nothing else failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FILE = path.join(ROOT, 'fees.html');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const src = fs.readFileSync(FILE, 'utf8');

/* ---- extract the shipped tile block, verbatim, between two anchors ---- */
const startAnchor = 'const tiles=[]';
const start = src.indexOf(startAnchor);
if (start < 0) {
  console.log('  FAIL  tile block anchor not found in fees.html');
  console.log(`\n  ${pass} passed, ${fail + 1} failed`);
  process.exit(1);
}
const tail = src.indexOf("+'</div>';", start);
const block = src.slice(start, tail + "'</div>';".length);

/* the page's own helpers, reproduced exactly so the tile block runs unchanged */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderHeadline(h, cur = '₦') {
  const m = n => cur + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out = Number(h.total_outstanding || 0) > 0;
  /* run the shipped statements exactly as written, then hand back the markup */
  return new Function('h', 'm', 'out', 'esc', `let html='';${block}\nreturn html;`)(h, m, out, esc);
}

/* pull the tiles back out of the rendered markup, in display order */
function tilesOf(html) {
  const out = [];
  const re = /<div style="font-size:1\.35rem;font-weight:900;color:([^"]+)">([^<]*)<\/div><div style="font-size:\.68rem;[^"]*">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) out.push({ colour: m[1], value: m[2], label: m[3] });
  return out;
}

/* nothing may survive as raw label,value,colour punctuation outside a tile */
function leaksMarkup(html) {
  const stripped = html.replace(/<div style="font-size:1\.35rem[\s\S]*?<\/div><div style="font-size:\.68rem[\s\S]*?<\/div>/g, '');
  return /Opening balance \(before School Connect\),|,₦|,#[0-9a-f]{6}/i.test(stripped);
}

const money = n => '₦' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const cases = [
  {
    name: 'A  screenshot case — bill 28,100, paid 20,000, arrears 3,000',
    h: { bill_known: true, net_bill: 28100, paid_this_term: 20000, balance_this_term: 8100, arrears: 3000, opening_arrears: 0, total_outstanding: 11100 },
    want: [['Total fees this term', money(28100)], ['Paid (all receipts)', money(20000)],
           ['Balance this term', money(8100)], ['Previous terms owing', money(3000)],
           ['TOTAL OUTSTANDING', money(11100)]],
    noOpening: true,
  },
  {
    name: 'B  opening balance entered — 7,000 must appear and count once',
    h: { bill_known: true, net_bill: 25000, paid_this_term: 10000, balance_this_term: 15000, arrears: 0, opening_arrears: 7000, total_outstanding: 22000 },
    want: [['Opening balance (before School Connect)', money(7000)], ['Total fees this term', money(25000)],
           ['Paid (all receipts)', money(10000)], ['Balance this term', money(15000)],
           ['Previous terms owing', '—'], ['TOTAL OUTSTANDING', money(22000)]],
    opening: true,
  },
  {
    name: 'C  nothing owing — the opening and arrears lines must read as blank',
    h: { bill_known: true, net_bill: 25000, paid_this_term: 25000, balance_this_term: 0, arrears: 0, opening_arrears: 0, total_outstanding: 0 },
    want: [['Total fees this term', money(25000)], ['Paid (all receipts)', money(25000)],
           ['Balance this term', money(0)], ['Previous terms owing', '—'], ['TOTAL OUTSTANDING', money(0)]],
    noOpening: true,
  },
  {
    name: 'D  fee not published — the bill must never read ₦0',
    h: { bill_known: false, net_bill: 0, paid_this_term: 0, balance_this_term: 0, arrears: 0, opening_arrears: 0, total_outstanding: 0 },
    want: [['Total fees this term', 'not published'], ['Paid (all receipts)', money(0)],
           ['Balance this term', money(0)], ['Previous terms owing', '—'], ['TOTAL OUTSTANDING', money(0)]],
    noOpening: true,
  },
];

console.log('\n  Fees page headline tiles (the file that ships)\n');

for (const c of cases) {
  console.log(`  ${c.name}`);
  const html = renderHeadline(c.h);
  const got = tilesOf(html);

  /* every expected tile, in order */
  ok('  tile order and values', JSON.stringify(got.map(t => [t.label, t.value])) === JSON.stringify(c.want.map(w => [w[0], w[1]])),
    'got ' + JSON.stringify(got.map(t => `${t.label}=${t.value}`)));

  const labels = got.map(t => t.label);
  const hasOpening = labels.some(l => l.startsWith('Opening balance'));
  if (c.opening) ok('  opening tile present when there is an opening balance', hasOpening);
  if (c.noOpening) ok('  no opening tile when there is nothing to show', !hasOpening);

  ok('  no raw "label,value,colour" text leaked into the page', !leaksMarkup(html));

  /* R1: the term bill is never inflated by anything owing from before */
  const bill = got.find(t => t.label === 'Total fees this term');
  if (bill && c.h.bill_known) ok('  term bill equals the published bill, not bill + arrears', bill.value === money(c.h.net_bill), bill.value);

  /* R2: the opening balance is counted exactly once, inside the total */
  if (c.opening) {
    const total = got.find(t => t.label === 'TOTAL OUTSTANDING');
    ok('  opening balance is inside the total, not added twice',
      total && total.value === money(c.h.balance_this_term + c.h.opening_arrears + c.h.arrears), total && total.value);
  }
  console.log('');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
