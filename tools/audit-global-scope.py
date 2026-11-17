#!/usr/bin/env python3
"""Find inline HTML handlers (onclick=, onchange=, oninput= …) that call a
top-level `const`/`let`/`class` declared in the same page.

A classic <script> `const Foo = {...}` does NOT become window.Foo, while an
inline onclick="Foo.bar()" is evaluated with `window` as its scope chain root.
The result is a silent ReferenceError the moment the user clicks — the button
looks perfect and does nothing. This catches that.

Exit status is non-zero when anything is found, so it can gate a release.
"""
from pathlib import Path
import re, sys

ROOT = Path(__file__).resolve().parents[1]
PAGES = sorted(set(list(ROOT.glob('*.html')) + list((ROOT/'assets'/'templates'/'pages').glob('*.html'))))

# names that are legitimately provided by the shared runtime
SHARED = {'App','CRUD','Super','Notifications','PWAInstall','ReportEngine','Chatbot','Analytics',
          'Voting','Chart','ChartJS','React','jQuery','$','_','firebase','supabase','sb','toast','esc',
          'setTimeout','setInterval','confirm','alert','prompt','console','JSON','Math','Object','Array',
          'Number','String','Boolean','Date','Promise','RegExp','Error','Intl','document','window','event',
          'location','history','navigator','localStorage','sessionStorage','fetch','URL','Blob','FileReader',
          'Image','Audio','FormData','encodeURIComponent','decodeURIComponent','parseInt','parseFloat',
          'isNaN','isFinite','requestAnimationFrame','crypto','indexedDB','CSS','CustomEvent','Event',
          'MutationObserver','IntersectionObserver','ResizeObserver','Worker','Notification','btoa','atob'}

problems = []
for page in PAGES:
    src = page.read_text(errors='replace')
    # top-level declarations in inline scripts
    declared = set()
    for m in re.finditer(r'<script\b([^>]*)>([\s\S]*?)</script\s*>', src, re.I):
        attrs, code = m.group(1), m.group(2)
        if re.search(r'\bsrc\s*=', attrs, re.I): continue
        for d in re.finditer(r'^\s*(?:const|let|class)\s+([A-Za-z_$][\w$]*)', code, re.M):
            declared.add(d.group(1))
    if not declared: continue
    # which of those are exported to window?
    exported = set(re.findall(r'window\.([A-Za-z_$][\w$]*)\s*=', src))
    exported |= set(re.findall(r'globalThis\.([A-Za-z_$][\w$]*)\s*=', src))
    # what do inline handlers reference?
    used = set()
    for m in re.finditer(r'on(?:click|change|input|submit|keyup|keydown|load|blur|focus)\s*=\s*["\']([^"\']*)["\']', src, re.I):
        for r in re.finditer(r'(?<![.\w$])([A-Z][\w$]*)\s*\.', m.group(1)):
            used.add(r.group(1))
    dead = sorted((declared & used) - exported - SHARED)
    if dead:
        problems.append((page.relative_to(ROOT).as_posix(), dead))

if problems:
    print(f'{len(problems)} page(s) with handler-invisible globals:\n')
    for p, names in problems:
        print(f'  {p}')
        print(f'      {", ".join(names)}')
    sys.exit(1)
print(f'{len(PAGES)} pages checked — every inline handler target is reachable.')
