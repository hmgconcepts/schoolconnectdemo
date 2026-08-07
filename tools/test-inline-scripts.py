#!/usr/bin/env python3
from pathlib import Path
import re,subprocess,sys,tempfile
bad=[];count=0
files=list(Path('.').glob('*.html'))+list(Path('assets/templates/pages').glob('*.html'))
for f in files:
 s=f.read_text(errors='replace')
 for i,m in enumerate(re.finditer(r'<script\b([^>]*)>([\s\S]*?)</script\s*>',s,re.I)):
  attrs,code=m.group(1),m.group(2)
  if re.search(r'\bsrc\s*=',attrs,re.I)or re.search(r'type\s*=\s*["\'](?:application/ld\+json|application/json)["\']',attrs,re.I)or not code.strip():continue
  count+=1
  with tempfile.NamedTemporaryFile('w',suffix='.js',delete=False)as t:t.write(code);name=t.name
  r=subprocess.run(['node','--check',name],capture_output=True,text=True)
  Path(name).unlink(missing_ok=True)
  if r.returncode:bad.append((str(f),i,r.stderr.strip()))
print(f'Inline JavaScript: {count} script blocks checked, {len(bad)} failures')
for f,i,e in bad[:20]:print(f'FAIL {f} script {i}\n{e}')
sys.exit(1 if bad else 0)
