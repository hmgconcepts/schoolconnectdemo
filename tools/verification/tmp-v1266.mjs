import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { schemaText } from './schema-loader.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const S = p => schemaText(HERE + '../../database/' + p);
const db = await PGlite.create();
await db.exec(fs.readFileSync(HERE + 'pglite-boot.sql', 'utf8'));
try { await db.exec(S('complete-schema.sql')); console.log('base ok'); }
catch(e){ console.log('BASE ERR:', String(e.message).slice(0,400)); process.exit(1); }
try { await db.exec(S('v12.66-one-truth-and-remap.sql')); console.log('PACK OK'); }
catch(e){ console.log('PACK ERR:', String(e.message).slice(0,600)); }
