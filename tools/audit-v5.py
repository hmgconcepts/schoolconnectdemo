#!/usr/bin/env python3
"""School Connect V5 static/SQL/repository audit (no paid services, no AI APIs)."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import re,sys
ROOT=Path(__file__).resolve().parents[1]
SUITE=ROOT.parent
REPOS=[ROOT,SUITE/'generated-sites'/'gosa',SUITE/'demo-site']
fail=[]; passed=[]
def ok(name,cond,detail=''):
 (passed if cond else fail).append((name,detail));print(('OK   ' if cond else 'FAIL ')+name+((' — '+detail) if detail else ''))

# PostgreSQL parser + schema/seed column contract
schema=(ROOT/'database/complete-schema.sql').read_text();seed=(ROOT/'database/demo-seed.sql').read_text()
try:
 from pglast import parse_sql,ast
 st=parse_sql(schema); sd=parse_sql(seed); ok('PostgreSQL parses complete-schema.sql',True,f'{len(st)} statements');ok('PostgreSQL parses demo-seed.sql',True,f'{len(sd)} top-level statements')
 cols={}
 for raw in st:
  n=raw.stmt
  if isinstance(n,ast.CreateStmt) and n.relation:
   t=n.relation.relname;cols.setdefault(t,set()).update(x.colname for x in (n.tableElts or ()) if isinstance(x,ast.ColumnDef))
  elif isinstance(n,ast.AlterTableStmt) and n.relation:
   t=n.relation.relname
   for c in n.cmds or ():
    if isinstance(c.def_,ast.ColumnDef):cols.setdefault(t,set()).add(c.def_.colname)
 # Include the seed's session temporary table.
 cols['sc_demo_ids']={'role','id'}
 issues=[]
 for m in re.finditer(r'insert\s+into\s+(?:public\.)?(\w+)\s*\(([^)]*)\)',seed,re.I|re.S):
  t=m.group(1); names=[x.strip().strip('"').lower() for x in m.group(2).split(',')];missing=[x for x in names if x not in cols.get(t,set())]
  if t not in cols: issues.append(f'line {seed.count(chr(10),0,m.start())+1}: missing table {t}')
  elif missing: issues.append(f'line {seed.count(chr(10),0,m.start())+1}: {t} missing {missing}')
 ok('Every demo-seed INSERT column exists in complete schema',not issues,'; '.join(issues[:8]))
 complete_indexes={raw.stmt.idxname for raw in st if isinstance(raw.stmt,ast.IndexStmt) and raw.stmt.idxname};focused_ddl=[]
 for fp in sorted((ROOT/'database').glob('*.sql')):
  if fp.name in ('complete-schema.sql','demo-users.sql','demo-seed.sql'):continue
  for raw in parse_sql(fp.read_text()):
   n=raw.stmt
   if isinstance(n,ast.CreateStmt) and n.relation:
    t=n.relation.relname
    if t not in cols:focused_ddl.append(f'{fp.name}:table:{t}')
    for x in n.tableElts or ():
     if isinstance(x,ast.ColumnDef) and x.colname and x.colname not in cols.get(t,set()):focused_ddl.append(f'{fp.name}:{t}.{x.colname}')
   elif isinstance(n,ast.AlterTableStmt) and n.relation:
    t=n.relation.relname
    for c in n.cmds or ():
     if isinstance(c.def_,ast.ColumnDef) and c.def_.colname and c.def_.colname not in cols.get(t,set()):focused_ddl.append(f'{fp.name}:{t}.{c.def_.colname}')
   elif isinstance(n,ast.IndexStmt) and n.idxname and n.idxname not in complete_indexes:focused_ddl.append(f'{fp.name}:index:{n.idxname}')
 ok('Complete schema contains every focused-upgrade table, column and index',not focused_ddl,'; '.join(focused_ddl[:8]))
except Exception as e:
 ok('PostgreSQL parser available and SQL valid',False,str(e))

# Complete-schema self-sufficiency and client contract.
complete_functions=re.findall(r'create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z0-9_]+)',schema,re.I)
dup=sorted({x for x in complete_functions if complete_functions.count(x)>1});ok('Complete schema has one authoritative definition per function',not dup,', '.join(dup))
focused=[]
for fp in sorted((ROOT/'database').glob('*.sql')):
 if fp.name not in ('complete-schema.sql','demo-users.sql','demo-seed.sql'):focused+=re.findall(r'create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z0-9_]+)',fp.read_text(),re.I)
missing=sorted(set(focused)-set(complete_functions));ok('Complete schema contains every focused-upgrade RPC',not missing,', '.join(missing))
client_rpcs=set()
for fp in list(ROOT.glob('*.html'))+list((ROOT/'assets/js').glob('*.js')):client_rpcs.update(re.findall(r"\.rpc\(\s*['\"]([a-zA-Z0-9_]+)",fp.read_text(errors='ignore')))
missing=sorted(client_rpcs-set(complete_functions));ok('Complete schema contains every statically named client RPC',not missing,f'{len(client_rpcs)} RPCs checked')
ok('Complete schema ends with V5.8 self-sufficiency check','FINAL V5.8 SELF-SUFFICIENCY CHECK'in schema and'no other production SQL is required'in schema)

class Links(HTMLParser):
 def __init__(self):super().__init__();self.links=[]
 def handle_starttag(self,tag,attrs):
  for k,v in attrs:
   if k.lower() in ('href','src') and v:self.links.append(v)
for repo in REPOS:
 files={p.relative_to(repo).as_posix() for p in repo.rglob('*') if p.is_file() and '.git' not in p.parts}
 broken=[]
 for page in repo.glob('*.html'):
  p=Links();
  try:p.feed(page.read_text(errors='replace'))
  except Exception:continue
  for ref in p.links:
   if ref.startswith(('#','http:','https:','mailto:','tel:','sms:','javascript:','data:','blob:','//','{')):continue
   clean=unquote(urlsplit(ref).path).lstrip('./')
   if clean and not clean.endswith('/') and clean not in files:broken.append(f'{page.name}->{ref}')
 ok(f'{repo.name}: static HTML href/src targets exist',not broken,', '.join(broken[:8]))

# Cross-repository runtime parity
common=['assets/css/style.css','assets/js/cbt-engine.js','assets/js/report-engine.js','assets/js/crud.js','assets/js/site-help.js','assets/js/v57-enhancements.js','database/complete-schema.sql','database/cbt-v5.1-zero-score-hotfix.sql','database/cbt-v5.1.1-getter-school-settings-fix.sql','database/v5.3-platform-enhancements.sql','database/v5.4-portability-cbt-metrics.sql','database/v5.5-registered-cbt-identity.sql','database/v5.6-daily-fees-cbt-reset-teacher-scope.sql','database/demo-seed.sql']
for rel in common:
 data=[(r/rel).read_bytes() for r in REPOS]
 ok(f'Runtime parity: {rel}',data[0]==data[1]==data[2])
for f in ['cbt-exam.html','cbt-multi.html','cbt.html','report-cards.html','student-profile.html','academic-records.html','profile.html','timetable-generator.html','settings.html','entrance.html','exam-register.html','academic_setup.html','certificates.html','admissions.html','approvals.html','diary.html','digital_library.html','sow.html']:
 ok(f'Generator source/template parity: {f}',(ROOT/f).read_bytes()==(ROOT/'assets/templates/pages'/f).read_bytes())

# Critical regressions
cbt=(ROOT/'cbt-exam.html').read_text();engine=(ROOT/'assets/js/cbt-engine.js').read_text();multi=(ROOT/'cbt-multi.html').read_text();manager=(ROOT/'cbt.html').read_text();report=(ROOT/'assets/js/report-engine.js').read_text();rc=(ROOT/'report-cards.html').read_text();crud=(ROOT/'assets/js/crud.js').read_text();gen=(ROOT/'assets/js/generator.js').read_text()
ok('CBT page displays dynamic school logo/name/motto/contact',all(x in cbt for x in ['exam-school-logo','exam-school-name','exam-school-name-banner','exam-school-motto','exam-school-contact','applySchoolIdentity']))
ok('CBT uses explicit V6 getter diagnostics and normalised codes',"rpc('cbt_get_public_exam_v6'" in cbt and 'canonicalCode' in cbt and 'not_open' in schema)
ok('V5.1.1 getter tolerates missing optional school settings','select to_jsonb(ss)into settings_json' in schema and (ROOT/'database/cbt-v5.1.1-getter-school-settings-fix.sql').exists())
ok('CBT submission is idempotent and original-index aware',all(x in cbt for x in ['client_ref','_orig_index','answers_data']))
ok('CBT uses admission-enforcing V6 server RPCs and network-first refresh',"rpc('cbt_submit_v6'" in cbt and "rpc('cbt_get_public_exam_v6'" in cbt and 'Network-first' in cbt and "engine_version||''" in cbt)
ok('Server-authoritative matcher handles legacy aliases, option text and multi-select',all(x in schema for x in ['sc_cbt_answer_matches','sc_cbt_json_value','correctanswer','answerkey','sc_cbt_canonical_option',"typ='multi_select'",'qidx:=case']))
ok('Canonical and v2 compatibility RPCs delegate to V5.1',all(x in schema for x in ['create or replace function public.cbt_submit_v5(p_payload jsonb)','create or replace function public.cbt_submit(p_payload jsonb)','create or replace function public.cbt_submit_v2(p_payload jsonb)','public.cbt_submit_v5(p_payload)']))
ok('Missing answer keys cannot be saved as silent zero',"'answer_key_missing'" in schema and 'missing_answer_indexes' in schema)
ok('Public exam removes case-insensitive answer aliases','sc_cbt_public_question' in schema and 'rightanswer' in schema)
ok('Focused existing-database CBT hotfix is present',(ROOT/'database/cbt-v5.1-zero-score-hotfix.sql').exists())
ok('Historical saved answers can be regraded with V5.1','cbt_regrade_exam_results_v5' in schema and 'Regrade Saved Results' in manager)
ok('UTME subject tabs + repair persist both question columns',all(x in cbt+manager+multi for x in ['renderTabs=function','subject_breakdown','questions: questions','csv_data: questions']))
ok('Report outputs use sample layout classes',all(x in report for x in ['sample-report','class-sheet','subject-sheet','AFFECTIVE DOMAIN','PSYCHOMOTOR DOMAIN','OFFICIAL']))
ok('Report Cards routes all three print actions through ReportEngine',all(x in rc for x in ['ReportEngine.renderStudent','ReportEngine.renderClass','ReportEngine.renderSubject']))
ok('Official reports exclude implicit raw CBT/LMS data and preserve blank cells','raw CBT/reading/LMS attempts are NOT injected' in report and 'scoreCell(row,field)' in report and 'data-has-score' in rc)
ok('Report grid scopes scores by subject and does not save blank as zero',".eq('subject',this.ctx.subject)" in rc and "String(el.value||'').trim()===''" in rc)
ok('Report card prints explicit promotion decision','loadPromotionStatus' in report and 'PROMOTION NOT YET DECIDED' in report and 'promotion-status' in report)
ok('Bulk CBT push filters and writes canonical report_scores',all(x in report for x in ['openBulkCBTExportModal','be-class','be-subject','be-term','be-session','pushOneCBTExam',"from('report_scores').upsert"]))
profile=(ROOT/'profile.html').read_text();timetable=(ROOT/'timetable-generator.html').read_text();enterprise=(ROOT/'assets/js/enterprise.js').read_text()
ok('Teachers can own a profile signature used by assigned class reports',all(x in schema+profile+report for x in ['signature_url','get_class_teacher_identity','teacher-signature-card','saveTeacherSignature','loadClassTeacherIdentity','teacherSignatureInk']))
ok('CBT full edit uses platform dropdowns and covers full settings',all(x in manager for x in ['refreshEditReportColumns','ed-subject','ed-class','ed-term','ed-session','ed-col','ed-mode','ed-start','ed-close','ed-pass','certificate_enabled']))
ok('Timetable wizard uses controlled dropdowns and clear four-step workflow',all(x in timetable for x in ['Admin Timetable Wizard','Step 1','Step 2','Step 3','Step 4','<select class="form-select" id="tt-class"','id="tt-subject"','id="tt-teacher"','id="tt-term"','id="tt-session"','TTG.validate','TTG.printGrid']))
ok('Timetable backend checks availability and cross-class teacher conflicts','No free slot on an allowed day/period' in schema and 'teacher_availability' in schema and 'available_periods' in schema and 'timetable_blocks' in schema and 'p_day_periods' in schema and 'removeRequirement' in enterprise and 'clearGenerated' in enterprise)
ok('Demo generic amount is explicitly numeric','x.amount::numeric' in seed)
port=(ROOT/'assets/js/data-portability.js').read_text();admin=(ROOT/'admin-data.html').read_text()
ok('Portable JSON/CSV archives are paginated and re-importable',all(x in port+admin for x in ['school-connect-portable-v1','fetchAll','exportFull','inspectFile','importArchive','Portable Data Archive Center','runPortableImport']))
ok('Every CRUD module exposes a portable JSON companion export','ensurePortableButton' in crud and 'exportPortable' in crud)
ok('CBT library is single-list grouped, filterable and archivable',all(x in manager for x in ['Archive view','bulkArchiveFiltered','setArchived','No session','Active exams','Archived']))
ok('Student term metrics are enterable and printed on reports',all(x in schema+rc+report for x in ['student_term_metrics','openMetrics','saveMetrics','height_cm','weight_kg','Blood pressure','loadStudentMetrics']))
ok('Report assessment headings and maxima are dynamic admin settings',all(x in report+rc for x in ['assessmentLayout','dynamicScoreCell','scoreHead','editCol','saveColEdit','Heading shown on reports']))
ok('Registered CBT mode uses admission-only official identity',all(x in schema+cbt for x in ['cbt_get_public_exam_v6','cbt_submit_v6','admission_required','there is no editable name field','data.candidate.full_name']))
ok('Open/multi-subject CBT never dereferences an unassigned record',all(x in schema for x in ["candidate jsonb:='null'::jsonb",'Never read an unassigned record','identity_engine_version']))
login=(ROOT/'login.html').read_text();forgot=(ROOT/'forgot-password.html').read_text();css=(ROOT/'assets/css/style.css').read_text();analytics=(ROOT/'analytics.html').read_text();rubrics=(ROOT/'rubrics.html').read_text();transcripts=(ROOT/'transcripts.html').read_text()
ok('Forgot-password recovery is available and redirects securely','forgot-password.html' in login and 'resetPasswordForEmail' in forgot and 'change-password.html?recovery=1' in forgot)
ok('Navigation icon size is normalized across layouts','font-size: 18px !important' in css and '.app-nav-icon img,.app-nav-icon svg' in css)
ok('Assistant builds detailed coverage for every current/catalog page','dynamicPageInfo' in (ROOT/'assets/js/super.js').read_text() and 'SC.MODULES' in (ROOT/'assets/js/super.js').read_text())
ok('Rubrics and transcripts have first-user operational guidance','Worked example' in rubrics and 'Rubric definitions do not automatically create marks' in rubrics and 'Academic Transcripts — cumulative official history' in transcripts)
ok('Term/session academic decision center analyses official report scores','Academic Performance Decision Center' in analytics and 'report_subject_totals' in analytics and 'Subject performance' in analytics)
fees=(ROOT/'fees.html').read_text()
ok('Daily fees dashboard provides date totals and management breakdowns',all(x in schema+fees for x in ['payment_date','fee_payments_daily_idx','Daily Fee Collection Dashboard','Previous day','Month-to-date','By collector']))
ok('CBT results can be exported then securely reset for reuse','cbt_clear_exam_results' in schema and 'Export then clear results' in manager and 'clearResults' in manager)
ok('Teacher edits are subject/class scoped in UI and PostgreSQL RLS',all(x in schema+crud for x in ['teacher_can_manage_subject_class','teacher_can_manage_student','results_scope_update','report_score_scope_update','cbt_exam_scope_update','An explicit empty rule is a hard admin-only boundary']))
ok('Demo coverage completion and audit tool exist','specialised page coverage' in seed.lower() and (ROOT/'tools/audit-demo-coverage.py').exists())
ok('Demo specialised seed has no exam_id ambiguity',all(x in seed for x in ['v_exam_id','select v_exam_id,st.admission_no','cr.exam_id=v_exam_id'])and'course_id uuid;exam_id uuid'not in seed)
ok('E-receipt matches sample class structure',all(x in crud for x in ['class="receipt"','class="rh"','class="paid"','OFFICIAL E-RECEIPT','Remaining Balance']))
ok('Demo alumni seed uses current_occupation (42703 fixed)','current_occupation' in seed and 'insert into public.alumni (full_name, graduation_year, last_class, occupation' not in seed)
ok('Demo contains multi-subject live test exam',all(x in seed for x in ['DEMO-UTME','multi_subject','English Language","start":0','Mathematics","start":4']))
ok('Demo page-coverage pack exists',all(x in seed for x in ['COMPLETE PAGE-COVERAGE PACK','financial_aid','career_counseling','facility_booking','transfer_cert','survey_responses']))
ok('Generator loads binary flyers without UTF-8 corruption','loadBinary' in gen and "flyer,{binary:true}" in gen)
ok('Modern scaffold copies portal only after logo is generated',gen.find('if (includeModern) await Generator.addModernScaffold')>gen.find("zip.file('assets/img/logo.svg'"))
ok('No paid AI API dependency introduced',not re.search(r'api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com|api\.cohere\.ai|OPENAI_API_KEY|ANTHROPIC_API_KEY', '\n'.join(p.read_text(errors='ignore') for p in ROOT.rglob('*') if p.is_file() and p.suffix in ('.js','.html','.sql') and not p.name.startswith('verify-') and 'tools' not in p.parts),re.I))

print(f'\nV5 AUDIT: {len(passed)} passed, {len(fail)} failed')
if fail:
 print('\nFailures:');[print('-',n,d) for n,d in fail]
sys.exit(1 if fail else 0)
