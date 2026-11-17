#!/usr/bin/env python3
"""
V12.63 — promote page templates into the generator's own root pages.

THE BUG THIS FIXES
------------------
The generator repository ships an authoritative page in two places:

    assets/templates/pages/<page>.html   <- the SOURCE every client repo gets
    <page>.html                          <- the copy served from the
                                            generator's own site

`tools/sync-v5-repos.py` copies the template into gosaportal / schoolconnectdemo
but nothing ever refreshed the generator's own root pages. Over several releases
the two drifted: at the time this tool was written 25 of 70 root pages were
behind their template — `fees.html` by 22 KB and `idcards.html` by 7 KB, i.e.
the generator's own site was shipping without the V12.60/61/62/63 fixes that
every generated client already had. Anyone reviewing or demoing the product from
the main repo saw the old bugs.

WHAT IT DOES
------------
Copies each template over its root counterpart, but ONLY when the promotion is
provably safe: if the template's set of element ids and inline handler targets is
a superset of the root's, nothing can be lost. A page whose root copy has content
the template lacks is reported and left alone — silently overwriting a page is
how a "fix" deletes a feature.

    python3 tools/sync-root-pages.py             # report only (dry run)
    python3 tools/sync-root-pages.py --apply     # promote what is safe

V12.68 — `--reverse` closes the other half of the loop.
When a release edits the ROOT page first (that is where the feature is built and
tested), the template still holds the previous release. Promoting template→root
is then refused — correctly — because the root has ids and handlers the template
lacks. `--reverse` applies the SAME safety test in the opposite direction: the
root may be copied over the template only when every id, inline handler and
script the template references also exists in the root, i.e. nothing the
template can do would be lost. Then `sync-v5-repos.py` carries it to the clients.
"""
import re
import sys
from pathlib import Path

GEN = Path(__file__).resolve().parents[1]
TPL = GEN / 'assets' / 'templates' / 'pages'

# Pages that exist only in the generator shell and must never be overwritten.
# index.html and login.html are here for a subtler reason: the generator's own
# homepage is the VENDOR's sales page (sections blueprint / features / glimpse,
# plus the site chatbot), whereas assets/templates/pages/index.html is the
# SCHOOL's homepage that gets shipped to every client. Same filename, different
# jobs — promoting one over the other would replace a sales page with a school
# page. login.html is the same story: the root copy carries the extra
# staff/student/parent scenario chooser used on the demo site.
SKIP = {'builder.html', 'offline.html', 'index.html', 'login.html'}


def ids(text):
    return set(re.findall(r'\bid="([^"]+)"', text))


def handlers(text):
    """Inline event handler targets, e.g. onclick="ICUI.pdfAll()" -> ICUI.pdfAll."""
    out = set()
    for attr in re.findall(r'on(?:click|change|input|submit|keyup|keydown|load)="([^"]*)"', text):
        for target in re.findall(r'([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(', attr):
            out.add(target)
    return out


def script_sources(text):
    return set(re.findall(r'<script[^>]+src="([^"]+)"', text))


def reverse(apply_changes):
    """root -> template, with the same proof (nothing the template can do is lost)."""
    if not TPL.exists():
        raise SystemExit('templates directory not found: %s' % TPL)
    same = promoted = unsafe = 0
    refused = []
    for tpl in sorted(TPL.glob('*.html')):
        if tpl.name in SKIP:
            continue
        root = GEN / tpl.name
        if not root.exists():
            continue
        a = root.read_text(errors='replace')
        b = tpl.read_text(errors='replace')
        if a == b:
            same += 1
            continue
        lost_ids = ids(b) - ids(a)
        lost_handlers = handlers(b) - handlers(a)
        lost_scripts = script_sources(b) - script_sources(a)
        if lost_ids or lost_handlers or lost_scripts:
            unsafe += 1
            refused.append((tpl.name, sorted(lost_ids)[:6], sorted(lost_handlers)[:6],
                            sorted(lost_scripts)[:4]))
            continue
        promoted += 1
        print('  template <- root  %-28s %+7d bytes' % (tpl.name, len(a) - len(b)))
        if apply_changes:
            tpl.write_text(a)
    print('\n  identical: %d   promoted: %d   unsafe (left alone): %d' % (same, promoted, unsafe))
    if refused:
        print('\n  REFUSED — these templates have content the root page lacks:')
        for name, i, h, sc in refused:
            print('    %s' % name)
            if i: print('      ids      : %s' % ', '.join(i))
            if h: print('      handlers : %s' % ', '.join(h))
            if sc: print('      scripts  : %s' % ', '.join(sc))
    print('\n  %s' % ('APPLIED' if apply_changes else 'DRY RUN — re-run with --apply'))
    return 1 if refused else 0


def main(apply_changes):
    if not TPL.exists():
        raise SystemExit('templates directory not found: %s' % TPL)

    same = promoted = unsafe = noroot = 0
    unsafe_pages = []

    for tpl in sorted(TPL.glob('*.html')):
        if tpl.name in SKIP:
            continue
        root = GEN / tpl.name
        if not root.exists():
            noroot += 1
            continue

        a = root.read_text(errors='replace')
        b = tpl.read_text(errors='replace')
        if a == b:
            same += 1
            continue

        lost_ids = ids(a) - ids(b)
        lost_handlers = handlers(a) - handlers(b)
        lost_scripts = script_sources(a) - script_sources(b)

        if lost_ids or lost_handlers or lost_scripts:
            unsafe += 1
            unsafe_pages.append((tpl.name, sorted(lost_ids)[:6],
                                 sorted(lost_handlers)[:6], sorted(lost_scripts)[:4]))
            continue

        promoted += 1
        print('  promote %-30s %+7d bytes' % (tpl.name, len(b) - len(a)))
        if apply_changes:
            root.write_text(b)

    print('\n  identical: %d   promoted: %d   unsafe (left alone): %d   template-only: %d'
          % (same, promoted, unsafe, noroot))
    if unsafe_pages:
        print('\n  REFUSED — these root pages have content the template lacks:')
        for name, i, h, s in unsafe_pages:
            print('    %s' % name)
            if i: print('      ids      : %s' % ', '.join(i))
            if h: print('      handlers : %s' % ', '.join(h))
            if s: print('      scripts  : %s' % ', '.join(s))
    print('\n  %s' % ('APPLIED' if apply_changes else 'DRY RUN — re-run with --apply'))
    return 1 if unsafe_pages else 0


if __name__ == '__main__':
    if '--reverse' in sys.argv:
        sys.exit(reverse('--apply' in sys.argv))
    sys.exit(main('--apply' in sys.argv))
