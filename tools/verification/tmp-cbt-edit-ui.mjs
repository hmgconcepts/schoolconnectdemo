/* V12.70 — THE TUTOR'S EDIT, DRIVEN IN A REAL BROWSER.
   -------------------------------------------------------------------
   The school reported, eight times over, that a tutor edits a question in a
   pre-existing CBT, gets a success message, and the change is not there when
   they go back. Every previous fix was made in the database, and the database
   was never at fault: cbt_force_replace_bank_v3 stores exactly what it is
   given (proved separately by tmp-cbt-edit-repro.mjs).

   The defect was in the browser: saveQ() wrote the edit into an in-memory
   draft and then called editQuestions(), which re-fetched the exam from the
   database and rebuilt the list — silently discarding the edit. "Save all
   changes" then published the OLD bank and truthfully said it worked.

   Reading the code did not reveal that, twice. So this harness does what the
   tutor does: it opens the real cbt.html in Chromium, points it at a stub
   Supabase that records every RPC payload, and then CLICKS:
       Questions → Edit → change the text → Apply → Save all changes
   and asserts on the payload that the save actually sent.

   It also proves the CSV attach path merges into the open draft instead of
   clobbering it, and that closing with unsaved work warns.
   ========================================================================== */
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
if (!EXE || !chromium) {
  console.log('  SKIP  no Chromium/playwright available' + (resolveErr ? ' — ' + resolveErr.message : ''));
  process.exit(0);
}

const ORIGINAL = [
  { question: 'What is 2 + 2?', options: ['2', '3', '4', '5'], answer: 'C', type: 'mcq', mark: 1 },
  { question: 'What is 3 + 3?', options: ['5', '6', '7', '8'], answer: 'B', type: 'mcq', mark: 1 },
];
const EDITED_TEXT = 'EDITED BY TUTOR — what is 2 + 2 really?';

const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/.local/lib:' + (process.env.LD_LIBRARY_PATH || '') },
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
/* A page that navigates away mid-test destroys the execution context and the
   run dies with an unhelpful error. Some deployment configs redirect when no
   Supabase keys are present; the editor does not need that, so block it. */
await page.route('**/*', route => {
  const req = route.request();
  if (req.isNavigationRequest() && req.frame() === page.mainFrame() && req.url().includes('cbt.html#') === false && route.request().url() !== page.url() && page.url() && !route.request().url().includes('cbt.html')) return route.abort();
  return route.continue();
});
const errors = [];
page.on('pageerror', e => errors.push({msg:String(e && e.message || e), stack:String(e && e.stack || '').split('\n').slice(0,4).join(' | ')}));

/* A stub PostgREST/Supabase client. It answers the three shapes cbt.html uses:
   .from(t).select().eq().maybeSingle(), .rpc(name, args), and the builders in
   between. Everything else resolves to an empty result. */
await page.addInitScript(({ ORIGINAL }) => {
  const state = { csv: JSON.stringify(ORIGINAL), questions: JSON.stringify(ORIGINAL), version: 1, rpc: [] };
  window.__STUB = state;
  /* One chainable object per call: every builder method returns ITSELF and the
     object is also thenable, so `await supabase.from(t).select()` resolves the
     rows while `.select().eq().maybeSingle()` still works. */
  function chain(finalValue) {
    const api = {};
    Object.assign(api, {
      then: (res, rej) => Promise.resolve(finalValue).then(res, rej),
      catch: rej => Promise.resolve(finalValue).catch(rej),
      finally: fn => Promise.resolve(finalValue).finally(fn),
      eq: () => api, neq: () => api, order: () => api, limit: () => api, range: () => api,
      in: () => api, is: () => api, not: () => api, or: () => api, filter: () => api,
      select: () => api, update: () => api, insert: () => api, upsert: () => api,
      maybeSingle: () => Promise.resolve(finalValue && Array.isArray(finalValue.data)
        ? { data: finalValue.data[0] || null, error: finalValue.error }
        : finalValue),
      single: () => Promise.resolve(finalValue),
    });
    return api;
  }
  const examsRow = () => ({
    id: 'exam-1', code: 'ABC123', title: 'Test Exam', subject: 'Maths', class: 'JSS1',
    term: 'First Term', session: '2026/2027', bank_version: state.version,
    csv_data: state.csv, questions: state.questions, is_open: true, teacher_id: 'u1',
    anti_cheat_config: {}, max_score: 100, duration: 45, duration_min: 45,
  });
  window.sb = {
    from(table) {
      if (table === 'cbt_exams') {
        /* list reads must be ARRAYS (listExams spreads them); single reads use
           maybeSingle(), which wraps whatever it is given — and an object is a
           valid single row. So return a chain whose value is an array, and let
           maybeSingle() substitute the row. */
        return chain({ data: [examsRow()], error: null });
      }
      return chain({ data: [], error: null });
    },
    rpc(name, args) {
      state.rpc.push({ name, args: JSON.parse(JSON.stringify(args || {})) });
      if (name === 'cbt_force_replace_bank_v3') {
        const bank = args.p_bank || [];
        state.csv = JSON.stringify(bank); state.questions = JSON.stringify(bank);
        state.version += 1;
        return Promise.resolve({ data: { ok: true, hash: 'h' + state.version, version: state.version, count: bank.length }, error: null });
      }
      if (name === 'cbt_verify_exam_bank') {
        const n = JSON.parse(state.csv).length;
        return Promise.resolve({ data: { ok: true, count: n, questions_count: n, aliases_match: true, verified: true, bank_version: state.version }, error: null });
      }
      if (name === 'cbt_force_append_bank_v2') {
        const bank = JSON.parse(state.csv).concat(args.p_new_questions || []);
        state.csv = JSON.stringify(bank); state.questions = JSON.stringify(bank);
        return Promise.resolve({ data: { ok: true, added: (args.p_new_questions || []).length, total: bank.length, version: ++state.version, hash: 'a' }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }), getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() { } }),
    removeChannel: () => { },
  };
  window.SC_PROFILE = { id: 'u1', role: 'admin', status: 'approved', full_name: 'Tutor' };
  window.toast = window.toast || function () { };
  window.openModal = window.openModal || function (t, b, f) {
    let host = document.getElementById('modal-backdrop');
    if (!host) { host = document.createElement('div'); host.id = 'modal-backdrop'; document.body.appendChild(host); }
    host.innerHTML = '<div class="modal" style="background:#fff"><h3>' + t + '</h3><div id="modal-body">' + b + '</div><div id="modal-footer">' + (f || '') + '</div></div>';
    host.style.display = 'block';
  };
  window.closeModal = window.closeModal || function () { const h = document.getElementById('modal-backdrop'); if (h) h.style.display = 'none'; };
}, { ORIGINAL });

const url = 'file://' + ROOT + 'cbt.html';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.CBTUI && typeof window.CBTUI.editQuestions === 'function', { timeout: 20000 }).catch(() => { });

ok(await page.evaluate(() => !!(window.CBTUI && window.CBT && window.CBT.parseCSV)), 'the real cbt.html loaded its CBT engine and UI');

/* ---- the tutor opens the Questions tab ---- */
await page.evaluate(() => window.CBTUI.editQuestions('exam-1'));
await page.waitForTimeout(400);
const listedOriginal = await page.evaluate(() => document.querySelector('#modal-body')?.innerText || '');
ok(/What is 2 \+ 2/.test(listedOriginal), 'the question list shows the stored question', listedOriginal.slice(0, 120));

/* ---- Edit → change the text → Apply ---- */
await page.evaluate(() => window.CBTUI.editQ(0));
await page.waitForTimeout(200);
await page.evaluate(t => { document.getElementById('eq-q').value = t; }, EDITED_TEXT);
await page.evaluate(() => window.CBTUI.saveQ(0));
await page.waitForTimeout(300);

/* the list must show the tutor's own words, not the database's */
const listedAfterApply = await page.evaluate(() => document.querySelector('#modal-body')?.innerText || '');
ok(listedAfterApply.includes('EDITED BY TUTOR'), 'after Apply the LIST shows the edited text (this is what used to revert)', listedAfterApply.slice(0, 200));
ok(!/What is 2 \+ 2\?/.test(listedAfterApply), 'and the old text is gone from the list');
ok(/unsaved/i.test(listedAfterApply), 'the list states plainly that the change is unsaved');

/* the draft, not the database, is what will be published */
const draftQ0 = await page.evaluate(() => window.CBTUI._eq.qs[0].question);
ok(draftQ0 === EDITED_TEXT, 'the draft holds the edited question', draftQ0);

/* ---- re-render must not re-read the database (the original bug) ---- */
await page.evaluate(() => window.CBTUI._renderEditor());
await page.waitForTimeout(200);
const afterRerender = await page.evaluate(() => window.CBTUI._eq.qs[0].question);
ok(afterRerender === EDITED_TEXT, 're-rendering the list does not throw the edit away', afterRerender);

/* ---- Save all changes ---- */
await page.evaluate(() => window.CBTUI.saveQuestions());
await page.waitForTimeout(900);

const sent = await page.evaluate(() => window.__STUB.rpc.filter(r => r.name === 'cbt_force_replace_bank_v3'));
ok(sent.length === 1, 'exactly one publish RPC was sent', sent.length);
const payload = sent[0] && sent[0].args.p_bank;
ok(Array.isArray(payload) && payload.length === 2, 'the payload carries both questions', payload && payload.length);
const firstSent = payload && payload[0] && payload[0].question;
ok(firstSent === EDITED_TEXT, 'THE SAVED PAYLOAD CONTAINS THE TUTOR’S EDIT (the reported bug)', firstSent);
ok(!/What is 2 \+ 2\?$/.test(String(firstSent)), 'the pre-edit text is not in the payload');
ok(sent[0] && sent[0].args.p_expected_version === 1, 'the save carries the version it loaded (optimistic lock)', sent[0] && sent[0].args.p_expected_version);

const stubCsv = await page.evaluate(() => JSON.parse(window.__STUB.csv)[0].question);
ok(stubCsv === EDITED_TEXT, 'the database copy the stub now holds matches the edit', stubCsv);
ok(await page.evaluate(() => window.CBTUI._eq.dirty === false), 'after a verified save the draft is no longer marked unsaved');

/* ---- Attach CSV must merge into the open draft, not clobber it ---- */
await page.evaluate(() => window.CBTUI.editQuestions('exam-1'));
await page.waitForTimeout(300);
await page.evaluate(() => window.CBTUI.editQ(1));
await page.waitForTimeout(150);
await page.evaluate(() => { document.getElementById('eq-q').value = 'SECOND EDIT IN DRAFT'; });
await page.evaluate(() => window.CBTUI.saveQ(1));
await page.waitForTimeout(250);
const before = await page.evaluate(() => window.CBTUI._eq.qs.length);
await page.evaluate(() => window.CBTUI.appendCSV('exam-1'));
await page.waitForTimeout(150);
await page.evaluate(() => {
  document.getElementById('append-cbt-csv').value =
    'Question,A,B,C,D,CorrectAnswer,Explanation,Type\n"Brand new from CSV","1","2","3","4","A","","mcq"';
});
await page.evaluate(() => window.CBTUI.saveAppendCSV('exam-1', 'draft'));
await page.waitForTimeout(400);
const after = await page.evaluate(() => window.CBTUI._eq.qs.length);
ok(after === before + 1, 'Attach CSV added the new question to the open list', { before, after });
ok(await page.evaluate(() => window.CBTUI._eq.qs[1].question === 'SECOND EDIT IN DRAFT'), 'the tutor’s unsaved edit survived the CSV attach');
ok(await page.evaluate(() => /Brand new from CSV/.test(JSON.stringify(window.CBTUI._eq.qs))), 'the CSV question is in the same draft');

/* publish both together */
await page.evaluate(() => window.CBTUI.saveQuestions());
await page.waitForTimeout(900);
const savedAll = await page.evaluate(() => JSON.parse(window.__STUB.csv));
ok(savedAll.length === 3, 'one save published the edit AND the CSV question together', savedAll.length);
ok(savedAll[1].question === 'SECOND EDIT IN DRAFT' && /Brand new from CSV/.test(savedAll[2].question),
  'both the hand edit and the CSV row are on the server', savedAll.map(q => q.question));

/* ---- closing with unsaved work must warn, never discard silently ---- */
await page.evaluate(() => window.CBTUI.editQ(0));
await page.waitForTimeout(150);
await page.evaluate(() => { document.getElementById('eq-q').value = 'UNSAVED CHANGE'; });
await page.evaluate(() => window.CBTUI.saveQ(0));
await page.waitForTimeout(250);
await page.evaluate(() => window.CBTUI.closeEditor());
await page.waitForTimeout(250);
/* the title is part of the modal, so read the whole dialog */
const closeBody = await page.evaluate(() => (document.getElementById('modal-backdrop')?.innerText) || '');
ok(/Unsaved question changes/i.test(closeBody), 'closing with unsaved work shows a warning instead of discarding', closeBody.slice(0, 160));
ok(/Discard changes/i.test(closeBody) && /Save all changes/i.test(closeBody), 'the warning offers both Discard and Save', closeBody.slice(0, 240));
ok(await page.evaluate(() => !!(window.CBTUI._eq && window.CBTUI._eq.dirty)), 'and the draft is still there — nothing was thrown away');

/* a file:// page cannot register a ServiceWorker; that is the harness origin,
   not the app, so it is excluded from the error check */
const appErrors = errors.filter(e => !/ServiceWorker/i.test(e.msg));
ok(appErrors.length === 0, 'no uncaught JavaScript errors during the whole workflow', appErrors.slice(0, 3).map(e => e.msg + ' @ ' + e.stack));

await browser.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
