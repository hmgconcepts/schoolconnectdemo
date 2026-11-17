#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'assets/js/catalog.js');
const templatesPath = path.join(root, 'assets/js/templates.js');
const generatorPath = path.join(root, 'assets/js/generator.js');
const outPath = path.join(root, 'assets/js/module-registry.generated.json');

function read(p){ return fs.readFileSync(p, 'utf8'); }
const catalog = read(catalogPath);
const templates = read(templatesPath);
const generator = read(generatorPath);

function extractModules() {
  const start = catalog.indexOf('const MODULES = [');
  if (start === -1) throw new Error('MODULES array not found');
  const sub = catalog.slice(start);
  return [...sub.matchAll(/\{\s*id:'([^']+)',\s*name:'([^']+)'/g)].map(m => ({ id: m[1], name: m[2] }));
}

function extractArray(name) {
  const m = generator.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[(.*?)\\];`, 's'));
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

function extractMapFunction(functionName) {
  const idx = templates.indexOf(`${functionName}(id)`);
  if (idx === -1) return {};
  const sub = templates.slice(idx, idx + 8000);
  const m = sub.match(/const map = \{([\s\S]*?)\n\s*\};/);
  if (!m) return {};
  const obj = {};
  for (const mm of m[1].matchAll(/(?:'([^']+)'|(\w+))\s*:\s*'([^']*)'/g)) {
    const key = mm[1] || mm[2];
    obj[key] = mm[3];
  }
  return obj;
}

const modules = extractModules();
const pageIds = extractArray('pageIds');
const dedicated = extractArray('DEDICATED');
const icons = extractMapFunction('iconFor');
const labels = extractMapFunction('labelFor');

const dedicatedZipCalls = [...generator.matchAll(/zip\.file\('([^']+\.html)'\s*,\s*Generator\.([A-Za-z0-9_]+)/g)].map(m => ({ file: m[1], builder: m[2] }));
const dedicatedById = {};
for (const row of dedicatedZipCalls) {
  const id = row.file.replace(/\.html$/, '');
  dedicatedById[id] = row.builder;
}

const registry = modules.map(mod => {
  const dedicatedPage = Boolean(dedicatedById[mod.id]);
  const alwaysEmitted = dedicatedPage && ['cbt','about','contact'].includes(mod.id) ? true : false;
  const mode = dedicated.includes(mod.id) || dedicatedPage ? 'dedicated' : (pageIds.includes(mod.id) ? 'generic' : 'unknown');
  return {
    id: mod.id,
    name: mod.name,
    label: labels[mod.id] || mod.name,
    icon: icons[mod.id] || '◦',
    pageIdListed: pageIds.includes(mod.id),
    dedicatedProtected: dedicated.includes(mod.id),
    dedicatedBuilder: dedicatedById[mod.id] || null,
    generationMode: mode,
    outputFile: `${mod.id}.html`
  };
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), registry }, null, 2));
console.log(`Wrote ${outPath} with ${registry.length} module records.`);
