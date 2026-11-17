#!/usr/bin/env node
const fs=require('fs'),path=require('path'),vm=require('vm');
const {JSDOM}=require('jsdom');
const JSZip=require('jszip');
const root=path.resolve(__dirname,'..');
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://generator.test/builder.html',runScripts:'outside-only'});
const w=dom.window; w.console=console; w.JSZip=JSZip; w.alert=()=>{}; w.confirm=()=>true;
for(const f of ['assets/js/catalog.js','assets/js/templates.js','assets/js/generator.js']) w.eval(fs.readFileSync(path.join(root,f),'utf8'));
w.Generator.loadFile=async rel=>{try{return fs.readFileSync(path.join(root,rel),'utf8')}catch(e){return ''}};
w.Generator.loadBinary=async rel=>{try{return new Uint8Array(fs.readFileSync(path.join(root,rel)))}catch(e){return null}};
const base={schoolName:'V5 Automated Test College',shortName:'V5TC',schoolMotto:'Knowledge · Character · Service',address:'1 Test Avenue, Lagos',phone:'+234 800 000 0000',email:'test@example.com',siteUrl:'https://v5-test.example.com',themeId:'theme15',layout:'layout0',font:{id:'inter',family:'Inter',css:'Inter'},fontId:'inter',currency:'₦',admissionAcronym:'V5T',modules:w.SC.MODULES.map(x=>x.id),supabaseUrl:'YOUR_SUPABASE_URL',supabaseKey:'YOUR_SUPABASE_ANON_KEY',demoMode:true};
async function build(kind){
 const cfg={...base,buildType:kind};
 const result=await w.Generator.build(cfg); const ab=await result.blob.arrayBuffer(); const buf=Buffer.from(ab); const out=path.join(root,`test-output-${kind}.zip`);fs.writeFileSync(out,buf);
 const zip=await JSZip.loadAsync(buf), names=Object.keys(zip.files); const P=kind==='modern'?'modern/public/':'';
 const must=[P+'index.html',P+'login.html',P+'forgot-password.html',P+'change-password.html',P+'dashboard.html',P+'cbt-exam.html',P+'cbt-multi.html',P+'report-cards.html',P+'assets/js/cbt-engine.js',P+'assets/js/report-engine.js',P+'assets/js/data-portability.js',P+'assets/js/v57-enhancements.js','database/complete-schema.sql',P+'database/demo-users.sql',P+'database/demo-seed.sql',P+'assets/img/logo.svg',P+'assets/img/demo-signature.svg',
  /* V12.76 — a generated site must carry its own runtime. If these are missing the
     school's pages load nothing and stay blank, which is exactly what the CDN
     dependency used to do whenever the internet was down. */
  P+'assets/vendor/supabase-js-2.58.0.js',P+'assets/vendor/chart.umd.js',
  P+'assets/vendor/jsqr.min.js',P+'assets/vendor/jszip.min.js'];
 if(kind==='modern'){must.push('modern/package.json','modern/public/cbt-exam.html','modern/public/assets/img/logo.svg','modern/app/api/health/route.js');
  const dupes=names.filter(n=>/^[^/]+\.html$/.test(n)&&n!=='README.md');
  if(dupes.length)throw Error('modern ZIP still has duplicated root portal pages: '+dupes.slice(0,5));
 }
 const missing=must.filter(x=>!zip.file(x)); if(missing.length)throw new Error(kind+' missing: '+missing.join(', '));
 const cbt=await zip.file(P+'cbt-exam.html').async('string'), sql=await zip.file('database/complete-schema.sql').async('string');
 if(!cbt.includes('exam-school-logo')||!cbt.includes('renderTabs=function')||!cbt.includes("rpc('cbt_submit_v6'")||!cbt.includes('obsolete CBT grading engine'))throw new Error(kind+' has stale CBT template');
 const pageWithCdn=[];
 for(const n of names){ if(!/\.html$/.test(n)) continue; if(n.startsWith('modern/app/')||n.startsWith('modern/lib/')) continue;
   const t=await zip.file(n).async('string'); if(/cdn\.jsdelivr\.net/.test(t)) pageWithCdn.push(n); }
 if(pageWithCdn.length) throw new Error(kind+' still loads a library from a CDN: '+pageWithCdn.slice(0,5).join(', '));
 if(!sql.includes('sc_cbt_answer_matches')||!sql.includes('identity_engine_version')||!sql.includes('FINAL V5.8 SELF-SUFFICIENCY CHECK')||!sql.includes('V5.7 FINAL PROFESSIONAL AUDIT ENHANCEMENTS')||!sql.includes('V5.8 VERIFIED DELETION'))throw new Error(kind+' has stale schema');
 const retired=['database/cbt-v5.1-zero-score-hotfix.sql','database/cbt-v5.1.1-getter-school-settings-fix.sql','database/v5.3-platform-enhancements.sql','database/v5.4-portability-cbt-metrics.sql','database/v5.5-registered-cbt-identity.sql','database/v5.6-daily-fees-cbt-reset-teacher-scope.sql'];const unexpected=retired.filter(x=>zip.file(x));if(unexpected.length)throw new Error(kind+' exposes extra production SQL: '+unexpected.join(', '));
 for(let i=1;i<=8;i++){const f=zip.file(`${P}assets/img/ecosystem-flyers/flyer-${i}.jpg`);if(!f)throw new Error('missing flyer '+i);const b=await f.async('uint8array');if(!(b[0]===0xff&&b[1]===0xd8))throw new Error('corrupt flyer '+i);}
 const report={kind,entries:names.length,bytes:buf.length,orphans:result.audit.orphans.length,brokenLinks:result.audit.brokenLinks.length,missing};
 console.log(JSON.stringify(report));return report;
}
(async()=>{const reports=[await build('traditional'),await build('modern')];fs.writeFileSync(path.join(root,'test-generator-build-results.json'),JSON.stringify(reports,null,2));})().catch(e=>{console.error(e);process.exit(1)});
