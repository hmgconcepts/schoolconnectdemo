#!/usr/bin/env node
/**
 * V12.63 — build a sample ID-card PDF straight from the shipped engine, in a
 * real browser, and write it to disk.
 *
 * Why a browser and not a Node harness: the engine measures text with a canvas
 * and encodes photos through toDataURL(). Those are browser APIs, and jsdom
 * does not implement them faithfully. Testing the real code path is the only
 * way to be sure the file the admin downloads is the file we audited.
 *
 *   node tools/verification/pdf-build-sample.js [out.pdf] [layout]
 *     layout: side (default) | single | stack
 *
 * The sample deliberately contains:
 *   * a long multi-word name           -> exercises name wrapping
 *   * a record with NO photo           -> exercises the placeholder path
 *   * a record WITH a photo and QR     -> exercises the image path
 *   * an em dash in the brand name     -> exercises sanitize()
 *
 * Then run tools/verification/pdf-struct-check.py against the result.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.env.HOME || '/home/user', 'work/node_modules/playwright-core'));

const CHROME = process.env.CHROME_BIN ||
  '/home/user/.cache/ms-playwright/chromium-1140/chrome-linux/chrome';
const BASE = process.env.SC_BASE || 'http://127.0.0.1:8098';
const OUT = process.argv[2] || '/home/user/work/sample-id-cards.pdf';
const LAYOUT = process.argv[3] || 'side';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  /* the live config posts to Supabase; stub it out so the page loads offline */
  await page.route('**/assets/js/config.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: 'window.sb=null;'
  }));

  await page.goto(BASE + '/idcards.html?cb=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const result = await page.evaluate((layout) => {
    function photo(initial, colour) {
      const c = document.createElement('canvas');
      c.width = 300; c.height = 380;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 300, 380);
      grad.addColorStop(0, colour); grad.addColorStop(1, '#7c3aed');
      g.fillStyle = grad; g.fillRect(0, 0, 300, 380);
      g.fillStyle = '#fff'; g.font = 'bold 150px sans-serif';
      g.fillText(initial, 100, 250);
      return c;
    }
    const qr = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 200;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 200);
      g.fillStyle = '#000';
      for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++)
        if ((x * 7 + y * 13) % 5 < 2) g.fillRect(x * 8, y * 8, 8, 8);
      return c;
    })();

    const cards = [
      { front: { full_name: 'ABDUL HAMEED KHALEED MORAKINYO', staff_no: 'GOSA/S/001',
                 role: 'Principal', department: 'Administration', phone: '09111477795',
                 type: 'staff', photo: photo('A', '#1d4ed8'), qr },
        back:  { full_name: 'ABDUL HAMEED KHALEED MORAKINYO', staff_no: 'GOSA/S/001', type: 'staff' } },
      { front: { full_name: 'Adaeze Chukwuemeka-Okonkwo', admission_no: 'GOSA/2024/001',
                 class: 'JSS 1', arm: 'A', date_of_birth: '2012-04-17', blood_group: 'O+',
                 type: 'student', photo: photo('C', '#059669'), qr },
        back:  { full_name: 'Adaeze Chukwuemeka-Okonkwo', admission_no: 'GOSA/2024/001', type: 'student' } },
      /* deliberately photoless — must render the marked placeholder, and must
         appear in IDCardPDF.lastWarnings() */
      { front: { full_name: 'Balogun Oluwaseun Adebayo-Tijani', admission_no: 'GOSA/2024/002',
                 class: 'SS 2', arm: 'B', type: 'student', qr },
        back:  { full_name: 'Balogun Oluwaseun Adebayo-Tijani', admission_no: 'GOSA/2024/002', type: 'student' } }
    ];

    const brand = {
      name: 'God of Seed Academy', shortName: 'GOSA',
      motto: 'Excellence in Learning and Character',
      primary: '#0506ae', accent: '#964eec',
      address: '63B, Ishaga Abosule Street, Agbado Crossing, Ogun State',
      phone: '2348088667076', email: 'godofseedacademy@gmail.com'
    };

    const bytes = IDCardPDF.build(cards, {
      widthMm: 85.6, heightMm: 53.98,
      pageWidthMm: 210, pageHeightMm: 297,
      marginMm: 10, gapMm: 4, layout: layout, trim: true,
      brand: brand, title: 'ID Cards — audit', creator: 'School Connect'
    });

    let bin = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);

    return {
      b64: btoa(bin),
      bytes: bytes.length,
      warnings: IDCardPDF.lastWarnings(),
      selfTest: (typeof IDCardPDF.selfTest === 'function') ? IDCardPDF.selfTest(brand) : null
    };
  }, LAYOUT);

  await browser.close();
  fs.writeFileSync(OUT, Buffer.from(result.b64, 'base64'));

  console.log('wrote ' + OUT + ' (' + result.bytes + ' bytes)');
  if (result.selfTest) {
    console.log('self-test: ' + (result.selfTest.pass ? 'PASS' : 'FAIL — ' + result.selfTest.failures.join('; ')));
  }
  console.log('warnings: ' + (result.warnings.length ? JSON.stringify(result.warnings) : 'none'));
  if (errors.length) console.log('page errors: ' + JSON.stringify(errors));

  /* The photoless card must produce exactly one warning; if it does not, the
     silent-failure path has regressed. */
  const expected = result.warnings.filter(w => /no photo supplied/i.test(w.message)).length;
  const ok = expected === 1 && !errors.length && (!result.selfTest || result.selfTest.pass);
  console.log(ok ? 'BUILD OK' : 'BUILD PROBLEM');
  process.exit(ok ? 0 : 1);
})();
