#!/usr/bin/env node
const fs=require('fs'),vm=require('vm');
const sandbox={console,window:{SCHOOL:{}},localStorage:{getItem:()=>''},document:{},sb:null};
sandbox.window.window=sandbox.window;vm.createContext(sandbox);vm.runInContext(fs.readFileSync('assets/js/report-engine.js','utf8'),sandbox);
const R=sandbox.window.ReportEngine;let rpcName='',rpcArgs=null;
R.sb={rpc:async(name,args)=>{rpcName=name;rpcArgs=args;return{data:{ok:true,saved:1,skipped_unverified:1,skipped_manual:0,skipped_unidentified:0,created_column:true,attempt_policy:args.p_attempt_policy},error:null}}};
(async()=>{
 let n=0;const ok=(m,c)=>{if(!c)throw Error(m);console.log('OK  - '+m);n++};
 const exam={id:'exam-57',code:'MTERM1',class:'SS2',subject:'English',term:'First',session:'2026'};
 const out=await R.pushOneCBTExam(exam,'CA1',{createMissing:true,maxMark:20,verifiedOnly:true,subjectFilter:'English',attemptPolicy:'best',requireMidterm:true});
 ok('bulk push is routed through the authorized server RPC',rpcName==='sc_cbt_bulk_push_exam_v2');
 ok('server receives exam, destination, safe create, and max mark',rpcArgs.p_exam_id==='exam-57'&&rpcArgs.p_destination==='CA1'&&rpcArgs.p_create_missing===true&&rpcArgs.p_max_mark===20);
 ok('purpose filter and verified-only options reach the server',rpcArgs.p_require_midterm===true&&rpcArgs.p_verified_only===true&&rpcArgs.p_subject_filter==='English');
 ok('best/latest attempt policy is explicit and passed to the server',rpcArgs.p_attempt_policy==='best'&&out.attempt_policy==='best');
 ok('server-confirmed push reports saved, skipped and created-column counts',out.ok===true&&out.saved===1&&out.skipped_unverified===1&&out.created_column===true);
 console.log(`Bulk CBT server-push tests: ${n} passed`);
})().catch(e=>{console.error(e);process.exit(1)});
