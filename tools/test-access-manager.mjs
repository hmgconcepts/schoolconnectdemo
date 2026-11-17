// ============================================================================
// V12.4 Access Manager write-map proof (pass 72)
// Reproduces the user's exact scenario in a JS sandbox:
//   admin saves Write=staff for 'students' in the Page Access Manager →
//   a teacher's canWrite('students') must flip from false to TRUE.
// Also proves: map absent → defaults still apply; owner cockpit can never be
// opened; staff⇄teacher interchangeability; read map continues to work.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✓', n); } else { failed++; console.log('  ✗ FAIL', n); } };

// --- minimal browser sandbox able to load app.js + crud.js ---
const mem = new Map();
const sandbox = {
  window: {}, console, Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Set, Promise, parseInt, parseFloat, isFinite, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
  sessionStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  document: {
    addEventListener(){}, removeEventListener(){}, querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, createElement: () => ({ style:{}, classList:{ add(){}, remove(){}, toggle(){} }, setAttribute(){}, appendChild(){}, remove(){} }),
    body: { dataset: {}, appendChild(){}, classList:{ add(){}, remove(){} } },
    documentElement: { style: {} }, dispatchEvent(){}, readyState: 'complete', title: '', head:{appendChild(){}}
  },
  navigator: { userAgent: 'test', onLine: true, serviceWorker: { controller: null, register: () => Promise.resolve({}), addEventListener(){} } },
  location: { pathname: '/students.html', search: '', href: 'https://x/students.html', hostname:'x' },
  history: { replaceState(){} }, CustomEvent: class { constructor(n){ this.type = n; } },
  fetch: () => Promise.resolve({ ok: false }), toast: () => {}, openModal(){}, closeModal(){}, confirm: () => true, alert(){},
  MutationObserver: class { observe(){} disconnect(){} },
  requestAnimationFrame: f => setTimeout(f, 0), atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s,'binary').toString('base64'),
  URLSearchParams, URL
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => { try { vm.runInContext(readFileSync(join(here, '..', f), 'utf8'), sandbox, { filename: f }); } catch (e) { console.log('load warn', f, e.message); } };
load('assets/js/app.js');
load('assets/js/crud.js');
const App = sandbox.window.App, CRUD = sandbox.window.CRUD || sandbox.CRUD;
ok('App + CRUD loaded in sandbox', !!App && !!CRUD && typeof CRUD.canWrite === 'function');
ok('canWriteByAccess EXISTS now (was missing since V9)', typeof App.canWriteByAccess === 'function');

// --- scenario: teacher, no map saved ---
sandbox.window.SC_PROFILE = { id: 'u-teacher', role: 'teacher' };
App.currentRole = 'teacher';
App.roleWriteMap = null; App.roleAccessMap = null;
ok('default: teacher canNOT write students (shipped rule)', CRUD.canWrite('students') === false);
ok('default: teacher CAN write results (shipped rule)', CRUD.canWrite('results') === true);

// --- admin saves Write=staff for students (the user's exact action) ---
App.roleWriteMap = { students: ['staff'] };
ok('THE FIX: after admin grants Write=staff, teacher CAN write students', CRUD.canWrite('students') === true);
ok('staff role also gets it (staff⇄teacher)', (() => { sandbox.window.SC_PROFILE.role='staff'; App.currentRole='staff'; const r = CRUD.canWrite('students'); sandbox.window.SC_PROFILE.role='teacher'; App.currentRole='teacher'; return r === true; })());
ok('parent does NOT get it (map lists staff only)', (() => { sandbox.window.SC_PROFILE.role='parent'; App.currentRole='parent'; const r = CRUD.canWrite('students'); sandbox.window.SC_PROFILE.role='teacher'; App.currentRole='teacher'; return r === false; })());

// --- explicit map DENIAL beats a permissive default ---
App.roleWriteMap = { results: [] };
ok('admin can also REVOKE: empty saved list blocks teacher on results', CRUD.canWrite('results') === false);
App.roleWriteMap = { results: ['staff'] };
ok('…and restore it', CRUD.canWrite('results') === true);

// --- owner cockpit never openable from a map ---
App.roleWriteMap = { site_license: ['staff'], license: ['staff'] };
ok('site_license can never be opened via the map', CRUD.canWrite('site_license') === false && App.canWriteByAccess('license', 'teacher') === false);

// --- admin unaffected by maps ---
sandbox.window.SC_PROFILE = { id: 'u-admin', role: 'admin' }; App.currentRole = 'admin';
App.roleWriteMap = { students: [] };
ok('admin always writes regardless of map', CRUD.canWrite('students') === true);

// --- read map still governs page access for staff ---
sandbox.window.SC_PROFILE = { id: 'u-teacher', role: 'teacher' }; App.currentRole = 'teacher';
App.roleAccessMap = { hostel: [] };
ok('read map can hide an operational page from staff', App.canAccessPage('hostel.html', 'teacher') === false);
App.roleAccessMap = { hostel: ['staff'] };
ok('…and grant it back', App.canAccessPage('hostel.html', 'teacher') === true);
ok('MAP_IMMUNE pages ignore read-map hiding (idcards)', (() => { App.roleAccessMap = { idcards: [] }; return App.canAccessPage('idcards.html', 'teacher') === true; })());

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
