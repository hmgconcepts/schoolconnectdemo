/* V12.64 — verify the BROWSER ranking engine agrees with the SQL engine.
   The same fixture that tmp-rank.mjs runs against Postgres is fed to
   ReportEngine.rankCohort() in a real browser, and the two must agree exactly:
   same percentage, same position, same completeness flag.

   Run with the repo served on 8098:  node rank-check.js */
const { chromium } = require('/home/user/work/node_modules/playwright-core');

const CHROME = '/home/user/.cache/ms-playwright/chromium-1140/chrome-linux/chrome';
const BASE = process.env.SC_BASE || 'http://127.0.0.1:8098';

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + (x ? '  [' + x + ']' : '')); } };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**/assets/js/config.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.sb=null;' }));
  await page.goto(BASE + '/report-cards.html?cb=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const out = await page.evaluate(() => {
    // The tmp-rank.mjs fixture, as ReportEngine sees it after normalisation.
    const mk = (name, subject, total, max) => ({ student_name: name, class: 'JSS 2', subject, total, max, term: 'First Term', session: '2025/2026' });
    const rows = [
      mk('Ada Obi', 'Mathematics', 34, 100), mk('Ada Obi', 'English Language', 30, 100),
      mk('Ada Obi', 'Basic Science', 38, 100), mk('Ada Obi', 'Social Studies', 36, 100),
      mk('Bola Ade', 'Mathematics', 30, 100), mk('Bola Ade', 'English Language', 28, 100),
      mk('Bola Ade', 'Basic Science', 32, 100), mk('Bola Ade', 'Social Studies', 30, 100),
      mk('Chidi Eze', 'Mathematics', 38, 100)
    ];
    const c = ReportEngine.rankCohort(rows);
    const pick = n => { const p = c.byName[n] || {}; return { pct: p.percentage, pos: p.position, sub: p.subjectsSat, exp: p.subjectsExpected, total: p.total, expected: p.expected, complete: p.complete, rankable: p.rankable, basis: p.basis }; };
    return {
      ada: pick('Ada Obi'), bola: pick('Bola Ade'), chidi: pick('Chidi Eze'),
      load: c.expected, cohort: c.cohortSize,
      hasRankCohort: typeof ReportEngine.rankCohort === 'function'
    };
  });
  await browser.close();

  console.log('\n=== V12.64 browser ranking engine ===\n');
  console.log('  expected load:', JSON.stringify(out.load));
  console.log('  Ada  ', JSON.stringify(out.ada));
  console.log('  Bola ', JSON.stringify(out.bola));
  console.log('  Chidi', JSON.stringify(out.chidi));
  console.log('');

  ok(out.hasRankCohort, 'ReportEngine.rankCohort exists');
  ok(out.load.subjectCount === 4 && out.load.maxTotal === 400,
     'the expected load is 4 subjects / 400 marks', JSON.stringify(out.load));

  ok(Math.abs(out.ada.pct - 34.5) < 0.01, 'Ada = 34.50% of the full load', 'got ' + out.ada.pct);
  ok(Math.abs(out.bola.pct - 30.0) < 0.01, 'Bola = 30.00% of the full load', 'got ' + out.bola.pct);
  ok(Math.abs(out.chidi.pct - 9.5) < 0.01, 'Chidi = 9.50% — NOT 38%', 'got ' + out.chidi.pct);

  ok(out.ada.pos === 1, 'Ada is 1st', 'got ' + out.ada.pos);
  ok(out.bola.pos === 2, 'Bola is 2nd', 'got ' + out.bola.pos);
  ok(out.chidi.pos === null, 'Chidi is NOT ranked (1 of 4 subjects)', 'got ' + out.chidi.pos);

  ok(out.chidi.complete === false && out.ada.complete === true,
     'completeness recorded correctly',
     'chidi=' + out.chidi.complete + ' ada=' + out.ada.complete);
  ok(out.chidi.sub === 1 && out.chidi.exp === 4, 'Chidi recorded as 1 of 4 subjects',
     out.chidi.sub + '/' + out.chidi.exp);
  ok(/participation|provisional/i.test(out.chidi.basis || ''),
     'the reason is written on the card', out.chidi.basis);
  ok(out.cohort === 2, 'cohort counts only rankable candidates (Ada, Bola)', 'got ' + out.cohort);

  // whole-number tie behaviour
  const tie = await (async () => {
    const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const p = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
    await p.route('**/assets/js/config.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.sb=null;' }));
    await p.goto(BASE + '/report-cards.html?cb=' + Date.now(), { waitUntil: 'load' });
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const mk = (name, subject, total) => ({ student_name: name, class: 'JSS 3', subject, total, max: 100 });
      const rows = [];
      ['Mathematics', 'English Language', 'Basic Science', 'Social Studies'].forEach(s => {
        rows.push(mk('Aaron Tie', s, 60), mk('Bella Tie', s, 60), mk('Cara Third', s, 50));
      });
      const c = ReportEngine.rankCohort(rows);
      return { a: c.byName['Aaron Tie'].position, b: c.byName['Bella Tie'].position, c: c.byName['Cara Third'].position };
    });
    await b.close();
    return r;
  })();
  ok(tie.a === 1 && tie.b === 1, 'a genuine tie shares 1st place', JSON.stringify(tie));
  ok(tie.c === 3, 'the place after a tie is skipped (1,1,3)', JSON.stringify(tie));

  if (errs.length) { fail++; console.log('  FAIL  page errors: ' + JSON.stringify(errs.slice(0, 3))); }
  console.log('\n  ' + (fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)') + '  (' + pass + ' passed)\n');
  process.exit(fail === 0 ? 0 : 1);
})();
