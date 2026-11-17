#!/usr/bin/env python3
"""Expose top-level const/let/class UI controllers to window.

Any page that declares `const Foo = {...}` and then uses onclick="Foo.x()" is
broken at runtime: inline handlers resolve through window, and a classic script
`const` never lands there. This appends a tiny, idempotent exposure line to the
script that declares each such name, so the handler can find it.

Only names that are actually referenced by an inline handler are touched, and
only when they are not already exported — nothing else is rewritten.
"""
from pathlib import Path
import re, sys, subprocess

ROOT = Path(__file__).resolve().parents[1]
TARGET_NAME = re.compile(r'^([A-Za-z_$][\w$]*)$')

# reuse the audit to know exactly what is invisible
out = subprocess.run([sys.executable, str(ROOT/'tools'/'audit-global-scope.py')],
                     capture_output=True, text=True)
problems = {}
cur = None
for line in out.stdout.splitlines():
    m = re.match(r'^  ((?:assets/templates/pages/)?\S+\.html)$', line)
    if m:
        cur = m.group(1); problems[cur] = []; continue
    m = re.match(r'^\s{6}(.+)$', line)
    if m and cur is not None:
        problems[cur] = [x.strip() for x in m.group(1).split(',') if x.strip()]

changed = 0
for rel, names in problems.items():
    if not names: continue
    path = ROOT/rel
    src = path.read_text()
    made = []
    for name in names:
        if not TARGET_NAME.match(name): continue
        # find the inline <script> block that declares it at top level
        blocks = list(re.finditer(r'<script\b([^>]*)>([\s\S]*?)</script\s*>', src, re.I))
        target = None
        for b in blocks:
            if re.search(r'\bsrc\s*=', b.group(1), re.I): continue
            if re.search(r'^\s*(?:const|let|class)\s+' + re.escape(name) + r'\b', b.group(2), re.M):
                target = b; break
        if not target: continue
        code = target.group(2)
        if re.search(r'window\.' + re.escape(name) + r'\s*=', code):
            continue
        expose = f'\n/* V12.62: inline handlers resolve through window — expose the controller. */\nwindow.{name} = {name};\n'
        new_code = code + expose
        new_block = target.group(0).replace(code, new_code, 1)
        src = src[:target.start()] + new_block + src[target.end():]
        made.append(name)
    if made:
        path.write_text(src)
        changed += 1
        print(f'  {rel}: {", ".join(made)}')

print(f'\n{changed} page template(s) updated.')
