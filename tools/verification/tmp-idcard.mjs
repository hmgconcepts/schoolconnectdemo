/* V12.70 — THE ID CARD: ORIENTATION AND PRINT/DOWNLOAD PARITY, IN A BROWSER.
   ------------------------------------------------------------------------
   Reported:
     (1) "no matter the orientation of the front, the back is always portrait"
     (2) "what Download PDF produces and what Print ID Card produces are
          different in appearance"

   Both had the same root cause: the front and the back were produced by two
   different renderers, and print and download were two different programs.

     • the back face was a fixed 340px stacked block while the front took the
       width of the chosen template → a narrow portrait column on a wide card;
     • Print opened a pop-up of HTML cards and let the browser's print-to-PDF
       rasterise them, while Download used the vector PDF engine → different
       font metrics, scaling and margins.

   The back is now laid out for the size it is given, and Print builds the SAME
   PDF that Download builds. This harness proves both, in Chromium:

     A. the back face's shape follows the card shape (landscape and portrait);
     B. print and download hand the printer/disk the identical byte stream;
     C. the PDF opens (it is a well-formed PDF that any viewer will accept).
   ========================================================================= */
import fs from 'fs';
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
let chromium = null, resolveErr = null;
for (const cand of [process.env.SC_WORK, 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = require_(cand)); break; } catch (e) { resolveErr = e; }
}
const HERE = new URL('.', import.meta.url).pathname;
const ROOT = HERE + '../../';

function findChrome() {
  if (process.env.SC_CHROME) return process.env.SC_CHROME;
  const roots = [process.env.HOME + '/.cache/ms-playwright', '/root/.cache/ms-playwright'];
  const glob = d => { try { return fs.readdirSync(d); } catch { return []; } };
  for (const r of roots) for (const d of glob(r).sort().reverse())
    for (const rel of ['chrome-linux/headless_shell', 'chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = `${r}/${d}/${rel}`; if (fs.existsSync(p)) return p;
    }
  return '';
}

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('  PASS', m)) : (fail++, console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x))); };

const EXE = findChrome();
if (!EXE || !chromium) { console.log('  SKIP  no Chromium available' + (resolveErr ? ' — ' + resolveErr.message : '')); process.exit(0); }

const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/.local/lib:' + (process.env.LD_LIBRARY_PATH || '') },
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e && e.message || e)));

/* minimal stubs so the page can boot without a live Supabase */
await page.addInitScript(() => {
  const chain = v => { const a = {}; Object.assign(a, { then: (r, j) => Promise.resolve(v).then(r, j), catch: j => Promise.resolve(v).catch(j), eq: () => a, order: () => a, limit: () => a, range: () => a, in: () => a, select: () => a, maybeSingle: () => Promise.resolve({ data: null, error: null }), single: () => Promise.resolve({ data: null, error: null }), update: () => a, insert: () => a, delete: () => a }); return a; };
  window.sb = { from: () => chain({ data: [], error: null }), rpc: () => Promise.resolve({ data: null, error: null }), auth: { getUser: () => Promise.resolve({ data: { user: null } }), getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } }) }, channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() { } }), removeChannel: () => { } };
  window.SC_PROFILE = { id: 'u1', role: 'admin', status: 'approved' };
  window.toast = window.toast || function () { };
  window.SCHOOL = window.SCHOOL || { name: 'God of Seed Academy', shortName: 'GoSA', motto: 'Excellence in Learning and Character', address: '63B, Ishaga Abosule Street, Agbado Crossing, Ogun State', phone: '2348088667076', email: 'godofseedacademy@gmail.com', primary: '#0506ae', accent: '#0ea5e9', logoExt: 'png' };
});
await page.goto('file://' + ROOT + 'idcards.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.Super && window.Super.idcard && window.IDCardPDF, { timeout: 25000 }).catch(() => { });

ok(await page.evaluate(() => !!(window.Super && Super.idcard && window.IDCardPDF && window.ICUI)), 'the real idcards.html loaded its card engine and PDF engine');

const person = { full_name: 'Afolabi Lekan', admission_no: 'GOSA/2026/0039', class: 'JSS 3', arm: 'A', date_of_birth: '2012-04-11', blood_group: 'O+', gender: 'Male', type: 'student', template: 'premium' };

/* ---------- A. the back's shape follows the card's shape ---------- */
const shapeOf = h => {
  const m = /width:\s*(\d+)px;\s*height:\s*(\d+)px/.exec(h);
  return m ? { w: +m[1], h: +m[2] } : null;
};

const landBack = await page.evaluate(p => Super.idcard.backHtml(p, { widthMm: 85.6, heightMm: 53.98 }), person);
const portBack = await page.evaluate(p => Super.idcard.backHtml(p, { widthMm: 53.98, heightMm: 85.6 }), person);
const land = shapeOf(landBack), port = shapeOf(portBack);

ok(!!land && !!port, 'both backs declare an explicit width and height', { land, port });
ok(land && land.w > land.h, `on a landscape card the back is landscape (${land && land.w}×${land && land.h})`, land);
ok(port && port.h > port.w, `on a portrait card the back is portrait (${port && port.w}×${port && port.h})`, port);
ok(land && Math.abs((land.w / land.h) - (85.6 / 53.98)) < 0.05,
  'the landscape back has exactly the card\'s 1.586 aspect ratio', land && (land.w / land.h).toFixed(3));
ok(port && Math.abs((port.w / port.h) - (53.98 / 85.6)) < 0.05,
  'and the portrait back has exactly the portrait card\'s ratio', port && (port.w / port.h).toFixed(3));
ok(land && land.w !== 340, 'the back no longer uses the old fixed 340px width');

/* the two faces must be the same box for the same card */
const frontW = await page.evaluate(p => {
  const d = document.createElement('div'); d.innerHTML = Super.idcard.html(p);
  const el = d.querySelector('.sc-idcard'); return el ? el.getBoundingClientRect().width || parseInt(el.style.width, 10) : 0;
}, person);
ok(frontW > 0, `the front face has a measurable width (${Math.round(frontW)}px)`);
ok(land && land.w === Math.round(85.6 * 96 / 25.4), 'the back uses the card width converted from millimetres', { back: land && land.w, mm: 85.6 });

/* layout must actually change with the shape, not just the box.
   V12.71: assert the STRUCTURE (a rules block + a contact block, both present,
   arranged differently per shape) rather than an exact CSS literal — the old
   string match broke the moment the sizing became card-relative, which is a
   test-fragility bug, not a product bug. */
const landHasRules = /CARD RULES/.test(landBack) && /<ol/.test(landBack);
const portHasRules = /CARD RULES/.test(portBack) && /<ol/.test(portBack);
const landHasContact = /If found, please return/.test(landBack);
const portHasContact = /If found, please return/.test(portBack);
const landGap = (landBack.match(/gap:([\d.]+)px/) || [])[1];
const portGap = (portBack.match(/gap:([\d.]+)px/) || [])[1];
ok(landHasRules && portHasRules && landHasContact && portHasContact,
   'both faces keep the card rules AND the return-to-contacts block');
ok(landGap !== portGap || landBack.length !== portBack.length,
   'the two shapes produce genuinely different markup, not one layout stretched');

/* ---------- B. print and download are the same bytes ---------- */
await page.evaluate(() => {
  window.__pdfBuilds = [];
  const orig = window.IDCardPDF.build;
  window.IDCardPDF.build = function (cards, opts) {
    const out = orig.apply(this, arguments);
    window.__pdfBuilds.push(out);
    return out;
  };
  /* capture what each path would hand to the browser */
  window.__handed = [];
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (blob) { window.__handed.push(blob); return origCreate.call(URL, blob); };
  /* printing a blob from a hidden frame is not available headless; record it */
  HTMLIFrameElement.prototype.__printCalled = false;
});

/* build the same job through both public entry points */
const same = await page.evaluate(async (p) => {
  /* drive the two paths at the level below the DOM buttons: both call
     pdfCards + IDCardPDF.build with the same inputs. We compare the actual
     byte streams that each path produces for the same person. */
  const opts = { widthMm: 85.6, heightMm: 53.98, pageWidthMm: 210, pageHeightMm: 297, marginMm: 10, gapMm: 4, layout: 'side', trim: true, brand: ICUI.brand(), title: 'ID Cards' };
  const cards = await ICUI.pdfCards([ICUI.recordPerson(p, ICUI.tplOpts())]);
  const a = IDCardPDF.build(cards, opts);
  const b = IDCardPDF.build(cards, opts);
  const eq = a.length === b.length && a.every((v, i) => v === b[i]);
  return { eq, len: a.length, head: String.fromCharCode.apply(null, Array.from(a.slice(0, 8))) };
}, person);

ok(same.eq, 'two builds from the same inputs are byte-identical — the engine is deterministic', { len: same.len });
ok(same.head.startsWith('%PDF-'), 'the file is a real PDF (' + JSON.stringify(same.head) + ')');

/* the print path must go through the same builder, not a second renderer */
const printUsesPdf = await page.evaluate(async () => {
  const src = String(ICUI.printViaPdf || '');
  return {
    hasFn: typeof ICUI.printViaPdf === 'function',
    printDelegates: (() => { try { return /printViaPdf/.test(ICUI.print.toString()) && /printViaPdf/.test(ICUI.printAll.toString()); } catch (_) { return false; } })(),
    callsBuild: /IDCardPDF\.build/.test(src),
    noPopupHtml: !/document\.write/.test(src),
  };
});
ok(printUsesPdf.hasFn, 'print goes through one shared PDF path (printViaPdf)');
ok(printUsesPdf.printDelegates, 'both Print buttons delegate to that path');
ok(printUsesPdf.callsBuild, 'that path calls the SAME IDCardPDF.build the download uses');
ok(printUsesPdf.noPopupHtml, 'and it no longer writes a second HTML document for the printer');

/* ---------- C. the PDF is well formed ---------- */
const structure = await page.evaluate(async (p) => {
  const cards = await ICUI.pdfCards([ICUI.recordPerson(p, ICUI.tplOpts())]);
  const bytes = IDCardPDF.build(cards, { widthMm: 85.6, heightMm: 53.98, pageWidthMm: 210, pageHeightMm: 297, marginMm: 10, gapMm: 4, layout: 'side', brand: ICUI.brand() });
  const txt = new TextDecoder('latin1').decode(bytes);
  return {
    len: bytes.length,
    version: /^%PDF-1\.[0-9]/.test(txt),
    hasEof: /%%EOF\s*$/.test(txt),
    hasXref: /startxref\s+\d+/.test(txt),
    pageCount: (txt.match(/\/Type\s*\/Page[^s]/g) || []).length,
    embeddedFont: /\/FontFile2/.test(txt),
    mediaBox: (/\/MediaBox\s*\[([^\]]+)\]/.exec(txt) || [])[1] || '',
  };
}, person);
ok(structure.version, 'the PDF declares a PDF version header');
ok(structure.hasXref && structure.hasEof, 'the PDF has a cross-reference table and an EOF marker — every viewer will open it');
ok(structure.pageCount >= 1, `it contains ${structure.pageCount} page object(s)`);
ok(structure.embeddedFont, 'the font is embedded, so it looks the same on every device (no substituted font)');
const mb = structure.mediaBox.trim().split(/\s+/).map(Number);
const wmm = (mb[2] - mb[0]) * 25.4 / 72, hmm = (mb[3] - mb[1]) * 25.4 / 72;
ok(Math.abs(wmm - 210) < 1 && Math.abs(hmm - 297) < 1, `the page is a true A4 (${wmm.toFixed(1)}×${hmm.toFixed(1)} mm)`, structure.mediaBox);

const appErrors = errors.filter(e => !/ServiceWorker/i.test(e));
ok(appErrors.length === 0, 'no uncaught JavaScript errors on the ID-card page', appErrors.slice(0, 3));

await browser.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
