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
 const zip=await JSZip.loadAsync(buf), names=Object.keys(zip.files); const must=['index.html','login.html','forgot-password.html','change-password.html','dashboard.html','cbt-exam.html','cbt-multi.html','report-cards.html','assets/js/cbt-engine.js','assets/js/report-engine.js','assets/js/data-portability.js','assets/js/v57-enhancements.js','database/complete-schema.sql','database/demo-users.sql','database/demo-seed.sql','assets/img/logo.svg','assets/img/demo-signature.svg'];
 if(kind==='modern')must.push('modern/package.json','modern/public/cbt-exam.html','modern/public/assets/img/logo.svg','modern/app/api/health/route.js');
 const missing=must.filter(x=>!zip.file(x)); if(missing.length)throw new Error(kind+' missing: '+missing.join(', '));
 const cbt=await zip.file('cbt-exam.html').async('string'), sql=await zip.file('database/complete-schema.sql').async('string');
 if(!cbt.includes('exam-school-logo')||!cbt.includes('renderTabs=function')||!cbt.includes("rpc('cbt_submit_v6'")||!cbt.includes('obsolete CBT grading engine'))throw new Error(kind+' has stale CBT template');
 if(!sql.includes('sc_cbt_answer_matches')||!sql.includes('identity_engine_version')||!sql.includes('FINAL V5.8 SELF-SUFFICIENCY CHECK')||!sql.includes('V5.7 FINAL PROFESSIONAL AUDIT ENHANCEMENTS')||!sql.includes('V5.8 VERIFIED DELETION'))throw new Error(kind+' has stale schema');
 const retired=['database/cbt-v5.1-zero-score-hotfix.sql','database/cbt-v5.1.1-getter-school-settings-fix.sql','database/v5.3-platform-enhancements.sql','database/v5.4-portability-cbt-metrics.sql','database/v5.5-registered-cbt-identity.sql','database/v5.6-daily-fees-cbt-reset-teacher-scope.sql'];const unexpected=retired.filter(x=>zip.file(x));if(unexpected.length)throw new Error(kind+' exposes extra production SQL: '+unexpected.join(', '));
 for(let i=1;i<=8;i++){const f=zip.file(`assets/img/ecosystem-flyers/flyer-${i}.jpg`);if(!f)throw new Error('missing flyer '+i);const b=await f.async('uint8array');if(!(b[0]===0xff&&b[1]===0xd8))throw new Error('corrupt flyer '+i);}
 const report={kind,entries:names.length,bytes:buf.length,orphans:result.audit.orphans.length,brokenLinks:result.audit.brokenLinks.length,missing};
 console.log(JSON.stringify(report));return report;
}
(async()=>{const reports=[await build('traditional'),await build('modern')];fs.writeFileSync(path.join(root,'test-generator-build-results.json'),JSON.stringify(reports,null,2));})().catch(e=>{console.error(e);process.exit(1)});
