#!/usr/bin/env python3
from pathlib import Path
import json,re,subprocess,sys,tempfile
root=Path(__file__).resolve().parents[1];seed=(root/'database/demo-seed.sql').read_text().lower()
node="""const fs=require('fs'),vm=require('vm');const c={console:{log(){}},window:{},document:{addEventListener(){}},setTimeout(){}};vm.createContext(c);vm.runInContext(fs.readFileSync('assets/js/crud.js','utf8')+'\\nthis.X=CRUD;',c);let o={};for(const[k,v]of Object.entries(c.X.SCHEMA))o[k]={table:v.table,generic:false};for(const k of Object.keys(c.X.GENERIC))if(!o[k])o[k]={table:'module_records',generic:true,module:k};console.log(JSON.stringify(o));"""
r=subprocess.run(['node','-e',node],cwd=root,capture_output=True,text=True,check=True);defs=json.loads(r.stdout);missing=[]
exempt={'directory':'profiles'} # populated by required demo Auth/profile adoption
for module,d in defs.items():
 if module in exempt:continue
 ok=(f"insert into public.{d['table']}" in seed or f"insert into {d['table']}" in seed or f"update public.{d['table']}" in seed)
 if d.get('generic'):ok=(f"'{d['module']}'" in seed)
 if not ok:missing.append(f'{module}→{d["table"]}')
special=['attendance_checkins','cbt_roster','admission_letters','certificate_designs','teacher_availability','timetable_config','timetable_runs','punctuality_awards','student_term_metrics','activity_log','lms_courses','lms_lessons','lms_submissions','login_audit','security_prefs','i18n_strings']
for t in special:
 if f'insert into public.{t}' not in seed:missing.append('special:'+t)
print(f'Demo coverage: {len(defs)-len(missing)}/{len(defs)} CRUD modules plus {len(special)} specialised datasets covered')
for m in missing:print('MISSING',m)
sys.exit(1 if missing else 0)
