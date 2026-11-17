#!/usr/bin/env python3
"""Synchronise School Connect V5 runtime fixes into generated client repositories.

Brand-specific config.js and image assets are intentionally preserved. Rich HTML is
rebranded from the generator's field-proven templates using the same substitutions
as generator.js. Run from any directory; paths are resolved from this script.
"""
from pathlib import Path
import re, shutil

GEN=Path(__file__).resolve().parents[1]
ROOT=GEN.parent
# V12.60: the sibling checkouts are named gosaportal / schoolconnectdemo.
# The historical generated-sites/gosa and demo-site paths are kept as
# fallbacks so the script still works in the original authoring tree.
def _first_existing(*candidates):
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]

TARGETS={
    _first_existing(ROOT/'gosaportal', ROOT/'generated-sites'/'gosa'): dict(name='God of Seed Academy',short='GoSA',motto='Excellence in Learning and Character',address='63B, Ishaga Abosule Street, Agbado Crossing, Ogun State',phone='2348088667076',email='godofseedacademy@gmail.com',ext='png'),
    _first_existing(ROOT/'schoolconnectdemo', ROOT/'demo-site'): dict(name='School Connect Demonstration College',short='SCD',motto='A fully simulated school — explore every feature',address='HMG Demo Campus, Lagos, Nigeria',phone='+234 810 086 6322',email='buildingmyictcareer@gmail.com',ext='svg'),
}
RUNTIME=[
 # V12.76 — vendored third-party runtime (pages reference these instead of a CDN)
 'assets/vendor/supabase-js-2.58.0.js','assets/vendor/chart.umd.js',
 'assets/vendor/jsqr.min.js','assets/vendor/jszip.min.js',
 'assets/css/style.css','assets/js/app.js','assets/js/analytics.js','assets/js/cbt-engine.js','assets/js/cbt-types.js','assets/js/cbt-richtext.js','assets/js/cbt-speech.js','assets/js/chatbot.js',
 'assets/js/crud.js','assets/js/demo.js','assets/js/demo-sample-data.js','assets/js/recovery.js','assets/js/enterprise.js','assets/js/license.js',
 'assets/js/notifications.js','assets/js/ai-assistant.js','assets/js/drive-sync.js','assets/js/data-portability.js','assets/js/v57-enhancements.js','assets/js/pwa-install.js','assets/js/report-engine.js',
 'assets/js/site-help.js','assets/js/templates.js','assets/js/qrcode-generator.js','assets/js/QR-CODE-LICENSE.md','assets/js/super.js','assets/js/voting.js','assets/js/archive-hub.js','assets/js/cbt-archive.js','assets/js/assignment-cbt.js',
 'assets/js/keepalive-layers.js','assets/js/cbt-practice.js','assets/js/study-log.js','assets/js/ics-export.js','assets/js/learner-portfolio.js','assets/js/proctor.js','assets/js/theme-manager.js','assets/js/messages-center.js','assets/js/legibility.js',
 # V12.60 CorelDRAW-safe ID-card PDF engine (vector + embedded font + selftest)
 'assets/js/sc-pdf-fonts.js','assets/js/idcard-pdf.js','assets/js/idcard-pdf.selftest.js',
 'database/complete-schema.sql','database/cbt-v5.1-zero-score-hotfix.sql','database/cbt-v5.1.1-getter-school-settings-fix.sql','database/v5.3-platform-enhancements.sql','database/v5.4-portability-cbt-metrics.sql','database/v5.5-registered-cbt-identity.sql','database/v5.6-daily-fees-cbt-reset-teacher-scope.sql','database/demo-seed.sql','database/demo-users.sql','database/v9.0-user-lifecycle.sql','database/v9.1-enterprise-pack.sql','database/v9.2-access-and-fixes.sql','database/v9.4-fees-and-exams.sql','database/v9.7-leadership-access.sql','database/v9.9-aid-editors-subjects.sql','database/v10.0-fee-match-and-staffpay.sql','database/v10.1-staffpay-attendance-vetting.sql','database/v10.2-acl-status-manager.sql','database/v10.3-cbt-advanced-types.sql','database/v10.4-cbt-multisubject-rls.sql','database/v10.5-dl-cbt-link.sql','database/v10.6-cbt-review-community.sql','database/v10.7-fee-locks-arrears.sql','database/v10.8-fee-recompute.sql','database/v10.9-lock-coverage.sql','database/v10.9b-fee-doctor.sql','database/v11.0-timetable-pro.sql','database/v11.7-admission-year.sql','database/v11.9-voting-integrity.sql','database/v12.0-audit-columns.sql','database/v12.2-photo-sync.sql','database/v12.3-write-columns.sql','database/v12.5-schema-doctor.sql','database/v12.6-relink.sql','database/v12.7-archive-restore.sql','database/v12.8-assignment-cbt-bridge.sql','database/v12.9-assignment-fixes.sql','database/v12.10-final-fixes.sql','database/v12.11-assignment-final.sql','database/v12.12-report-student-fix.sql','database/v12.13-multi-assignment.sql','database/v12.14-robust-fixes.sql','database/v12.15-term-sheet-and-permissions.sql','database/v12.16-report-allow-and-multicombine.sql','database/v12.17-advanced-cbt-and-layers.sql','database/v12.18-heartbeat-updated-at-fix.sql','database/v12.19-platform-health-robust.sql','database/v12.20-cbt-full-edit-and-proctor.sql','database/v12.21-schema-doctor-v12.2-fix.sql','database/v12.22-theme-messages-notifications-drive-progress.sql','database/v12.23-fix-notif-mark-read-and-theme.sql','database/v12.24-fix-notif-clear-42883.sql','database/v12.25-fix-messages-sender-42703.sql','database/v12.26-theme-legibility-final.sql','database/v12.27-notification-legibility-fix.sql','database/v12.28-fix-cbt-teacher-create.sql','database/v12.29-idcard-dropdown-fix.sql','database/v12.30-notification-bell-legibility-fix.sql','database/v12.31-cbt-retake-robust.sql','database/v12.32-cbt-edit-and-class-fix.sql','database/v12.33-cbt-comprehensive-fix.sql','database/v12.34-cbt-attempt-and-robust-fixes.sql','database/v12.35-cbt-edit-push-categorisation-fix.sql','database/v12.36-cbt-missing-results-and-robust-fixes.sql','database/v12.37-cbt-civic-missing-and-edit-robust.sql','database/v12.38-cbt-total-view-and-all-cbt-audit.sql','database/v12.39-edit-bulletproof-and-server-pending.sql','database/v12.40-pwa-seamless-update.sql','database/v12.41-force-edit-and-pending-wal.sql','database/v12.42-math-keyboard-toggle-and-public-link.sql','database/v12.43-score-display-and-privacy.sql','database/v12.44-comprehensive-7-issues.sql','database/v12.45-edit-draft-publish-privacy.sql','database/v12.46-proctor-enforce-and-cache-bust.sql','database/v12.47-midterm-reports.sql','database/v12.48-cbt-integrity-network-and-midterm-sync.sql','database/v12.49-canonical-edit-append-verify.sql','database/v12.50-server-proctor-session-gate.sql','database/v12.51-runtime-cache-bust.sql','database/v12.52-midterm-roster-complete-and-context-sync.sql','database/v12.55-unify-midterm-assessment-and-report-mapping.sql','database/v12.56-cbt-assessment-check-constraint-safe.sql','database/v12.57-report-details-and-atomic-cbt-bulk-push.sql','database/v12.58-cbt-bank-alias-repair-and-verified-readback.sql','database/v12.60-expert-fix-pack.sql','database/v12.64-reporting-standards-fair-ranking.sql','database/v12.65-class-diary.sql','database/v12.66-one-truth-and-remap.sql','database/v12.67-fee-invoice-truth.sql','database/v12.68-bill-resolution.sql','database/v12.68-bootstrap.sql','database/complete-schema.manifest.json','database/v8.7-payroll-rebuild.sql','database/v8.5-payroll-net-fix.sql','database/v8.4-assignment-dl-points.sql','database/v8.2-voting-scope-and-dl.sql','database/v7.9-timetable-flex-and-class-scope.sql',
 'tools/build-complete-schema.py','tools/verify-complete-schema.mjs','tools/audit-schema-coverage.py','tools/sqlsplit.py',
 # V12.68 — the verifier now imports the shared dollar-quote-aware loader,
 # and boots PGlite from this file. Without them the shipped verifier cannot run.
 'tools/verification/schema-loader.mjs','tools/verification/pglite-boot.sql',
 # V12.68 — the executable proof that the complete schema is self-contained
 # (applies to a bare database with no auth schema and no roles, then twice).
 'tools/verification/tmp-selfcontained.mjs',
 # V12.68 — the colour-emoji face the emoji test embeds (OFL-1.1 subset of Noto
 # Color Emoji), so the check is decisive on a machine with no emoji font.
 'tools/verification/tmp-rerun-live.mjs','tools/verification/tmp-dirty-data.mjs',
 'tools/verification/tmp-notify-order.mjs','tools/verification/tmp-dash-card.mjs',
 'tools/audit-single-sql.py','tools/audit-duplicate-methods.py','tools/audit-repo-parity.py',
 'tools/audit-template-drift.py','tools/audit-client-seo.py',
 # V12.76 — the two new auditors and the vendoring tool travel with the product
 'tools/audit-client-hardening.py','tools/vendor-cdn-libs.py','tools/verification/t40-security-audit.mjs',
 'tools/verification/fonts/color-emoji-subset.woff2',
 'tools/verification/tmp-emoji-colour.mjs','tools/verification/tmp-purpose-guard.mjs','tools/verification/tmp-cbt-window.mjs','tools/verification/tmp-prep-ui.mjs','tools/verification/tmp-signature.mjs','tools/verification/tmp-cbt-recolumn.mjs','tools/verification/tmp-bulk-timeout.mjs','tools/verification/tmp-prep-family.mjs','tools/verification/tmp-fee-sync.mjs','tools/fix-logo-transparency.py', 'database/README.md','assets/img/demo-signature.svg','assets/img/founder-adewale.jpg','CBT_AND_REPORTCARD_GUIDE.md','ID_CARD_PRINT_GUIDE.md','DEPLOYMENT-GUIDE.md','DEPLOYMENT.md','FEATURES.md'
]
RICH=['midterm-reports.html','platform-health.html','developer.html','idcards.html','voting.html','messages.html','inbox.html','notifications.html','cbt-exam.html','cbt-multi.html','cbt.html','report-cards.html','student-profile.html','academic-records.html','profile.html','timetable-generator.html','admin-data.html','storage.html','health.html','login.html','change-password.html','forgot-password.html','rubrics.html','transcripts.html','analytics.html','fees.html','settings.html','entrance.html','exam-register.html','academic_setup.html','certificates.html','admissions.html','approvals.html','diary.html','digital_library.html','sow.html','exam-timetable.html','timetable.html','assignments.html','license.html','punctuality.html','checkin-staff.html','checkin.html','cbt-prompts.html','attendance.html']

VENDOR = 'schoolconnectportal.vercel.app'

def strip_vendor_canonical(text):
    """Remove a canonical link that names the VENDOR's site from a client page.

    V12.72 — suite.html and ecosystem.html shipped to both schools still saying
    `<link rel="canonical" href="https://schoolconnectportal.vercel.app/...">`.
    That tells a search engine the authoritative copy of a school's own page is
    the vendor's site: the school's page is treated as a duplicate and loses its
    ranking to us. A wrong canonical is worse than no canonical, so the honest
    fix is to remove it — a client deployment does not know its own final URL at
    build time, and inventing one would be a guess.

    Only the canonical is touched. Every other link to the vendor (the "made by
    HMG Concepts" credit) is left alone.
    """
    if VENDOR not in text:
        return text
    out = []
    for line in text.split('\n'):
        if 'rel="canonical"' in line and VENDOR in line:
            continue
        out.append(line)
    return '\n'.join(out)


def client_only(name, text):
    """Strip BUILDER-ONLY navigation from a page before it ships to a client.

    V12.70 (item 4 audit). `suite.html` is the HMG marketing page and DOES ship
    to client sites, but it carried `<li><a href="builder.html">Builder</a></li>`
    and `<a href="guide.html">Guide</a>` — pages that are deliberately not
    deployed. The result was dead navigation on a live public page. The
    marketing content stays; the links to internal tools go.
    """
    if name not in ('suite.html', 'index.html'):
        return text
    for gone in ('builder.html', 'guide.html', 'projects.html'):
        text = re.sub(r'\s*<li><a href="' + re.escape(gone) + r'">[^<]*</a></li>', '', text)
        text = re.sub(r'\s*<a href="' + re.escape(gone) + r'"[^>]*>[^<]*</a>', '', text)
    return text


def rebrand(text,cfg):
    for old in ['School Connect Demonstration College','School Connect Demo School','God of Seed Academy','Gosa Academy','GOD OF SEED ACADEMY']:
        text=text.replace(old,cfg['name'] if old!='GOD OF SEED ACADEMY' else cfg['name'].upper())
    text=text.replace('Excellence in Learning and Character',cfg['motto'])
    text=text.replace('A fully simulated school — explore every feature',cfg['motto'])
    text=text.replace('63B, Ishaga Abosule Street, Agbado Crossing, Ogun State',cfg['address'])
    text=text.replace('HMG Demo Campus, Lagos, Nigeria',cfg['address'])
    text=text.replace('2348088667076',cfg['phone']).replace('08088667076',cfg['phone'])
    text=text.replace('godofseedacademy@gmail.com',cfg['email']).replace('buildingmyictcareer@gmail.com',cfg['email'])
    text=re.sub(r'\b(?:GOSA|GoSA|GSA|SCD)\b',cfg['short'],text)
    # V12.73 (item 17) — the install banner said "Install School Connect" on
    # every client deployment. A parent installing the app on their phone was
    # told to install the VENDOR's product, not their school's portal. The
    # banner is the one place the school's own name must appear, because it is
    # the icon that ends up on the home screen.
    text=text.replace('Install School Connect',f"Install {cfg['short']}")
    text=text.replace('School Connect could not',f"{cfg['short']} could not")
    # the product name is right everywhere else (help pages, footers, credits),
    # so only the install banner is touched.
    text=re.sub(r'assets/img/logo\.(?:png|jpe?g|webp|svg)',f"assets/img/logo.{cfg['ext']}",text)
    return text

# V12.72 — set when a page template has fallen behind the page it mirrors.
# A mutable box, so the inner loop can raise the flag without a `global` and
# without the assignment silently landing in a local scope (which is exactly
# how it failed the first time).
TEMPLATE_DRIFT = {'drift': False}


def main():
    for target,cfg in TARGETS.items():
        if not target.exists(): raise SystemExit(f'Missing target: {target}')
        for rel in RUNTIME:
            src=GEN/rel
            if src.exists():
                dst=target/rel; dst.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src,dst)
        # V12.74 (round-18 item 8): sw.js was never synchronised, so the service
        # worker that actually runs in a client deployment was months behind the
        # generator's (schoolconnectdemo was still on v12.58). The worker carries
        # real logic — including the GET_VERSION reply the Update-now banner needs —
        # but its CACHE name is per-school. Copy the generator's worker and keep
        # the target's own cache name so branding is preserved.
        _sw = GEN/'sw.js'
        if _sw.exists():
            _dst = target/'sw.js'
            _keep = None
            if _dst.exists():
                _m = re.search(r"CACHE\s*=\s*'([^']+)'", _dst.read_text(encoding='utf-8'))
                if _m: _keep = _m.group(1)
            _txt = _sw.read_text(encoding='utf-8')
            if _keep:
                # V12.76 — KEEP THE SCHOOL'S NAME, TAKE THE VERSION.
                #
                # The old code copied the target's cache name verbatim, so a
                # client deployment's worker could carry new logic under an OLD
                # cache key: gosaportal was still answering `v12.59-20261101`
                # after three releases. The cache name is the version a device
                # compares, so a device that updated never dropped the old
                # entries — and this release rewrites every page to stop using a
                # CDN, which is exactly the kind of change a stale cache hides.
                # Prefix (`sc-client`) is branding; everything from `-v` onward
                # is version, and the generator owns it.
                _gen_m = re.search(r"CACHE\s*=\s*'([^']+)'", _txt)
                _gen = _gen_m.group(1) if _gen_m else ''
                _pre = _keep.split('-v')[0] if '-v' in _keep else _keep
                _ver = _gen[_gen.index('-v'):] if '-v' in _gen else ''
                _new = _pre + _ver if _ver else _keep
                _txt = re.sub(r"(CACHE\s*=\s*')[^']+(')",
                              lambda mm: mm.group(1)+_new+mm.group(2), _txt, count=1)
                print('  sw cache:', _keep, '->', _new)
            _dst.write_text(_txt, encoding='utf-8')
        # V12.60: sync every page the generator owns. The old hard-coded RICH
        # list of 42 silently left ~90 generated pages stale (students,
        # dashboard, index, apply, contact …) which is how the sibling repos
        # drifted away from the templates the generator ships.
        synced=set()
        pages=set(RICH)
        for p in (GEN/'assets'/'templates'/'pages').glob('*.html'):
            pages.add(p.name)
        for p in GEN.glob('*.html'):
            # V12.70 (item 4 audit): these pages belong to the BUILDER, not to a
            # deployed school. builder.html is "HMG Concepts Internal Platform
            # Builder"; projects.html is "My Projects" (a list of builder
            # drafts); guide.html is the builder's user guide. The old skip-list
            # named only builder.html and offline.html, so the other two were
            # shipped to both client sites — where every "Builder" link,
            # "Open Builder" button and "+ New Project" action pointed at
            # builder.html, which was deliberately NOT shipped. That is eleven
            # dead links per client deployment, one of them the primary
            # call-to-action on projects.html.
            if p.name in ('builder.html','offline.html','projects.html','guide.html'):
                continue        # generator-only shell / offline stub / builder pages
            pages.add(p.name)
        # template-only names map onto the generated file name the generator uses
        aliases={'ecosystem-products.html':'ecosystem.html'}
        # V12.70: a page that is generator-only must not linger in a client
        # deployment from an earlier sync — an undeleted copy keeps its dead
        # links alive and keeps the stale page in the sitemap/PWA cache.
        for gone in ('projects.html','guide.html'):
            if (target/gone).exists():
                (target/gone).unlink()
                print(f'  removed builder-only page from client deployment: {gone}')
        for rel in sorted(pages):
            src=GEN/'assets'/'templates'/'pages'/rel
            if not src.exists():
                src=GEN/rel
            if not src.exists():
                continue
            out=aliases.get(rel,rel)
            dst=target/out
            dst.parent.mkdir(parents=True,exist_ok=True)
            dst.write_text(client_only(out, strip_vendor_canonical(rebrand(src.read_text(),cfg))))
            synced.add(out)
        print(f'  pages synchronised: {len(synced)}')
        # V12.69: a page template that has fallen behind the root page it mirrors
        # is a silent regression — the template wins when rendering, so the fix
        # never reaches the client. Report it loudly instead of shipping it.
        # Two files are deliberate forks, not drift:
        #   index.html — the root is the School Connect product homepage; the
        #     template is each school's branded portal landing page.
        #   login.html — the root is the School Connect product login; the
        #     template is the school-branded login (it carries its own
        #     admission/staff re-link fields). Copying would rebrand a school's
        #     sign-in page as the vendor's.
        FORKED={'index.html','login.html'}
        stale=[]
        for t in sorted((GEN/'assets'/'templates'/'pages').glob('*.html')):
            r=GEN/t.name
            if not r.exists() or t.name in FORKED: continue
            if t.read_text()!=r.read_text():
                a=set(r.read_text().splitlines()); b=set(t.read_text().splitlines())
                if a-b:
                    stale.append(f'{t.name} (root has {len(a-b)} line(s) the template lacks)')
        if stale:
            # V12.72 — this used to be a warning, and a warning is not a gate.
            # V12.72 shipped with three templates behind (cbt-exam, cbt, profile)
            # and the only thing standing between the client and a missing
            # feature was whether somebody read a line of scrolling output.
            # A template behind its page is now a hard failure: the build says
            # so and the exit status is non-zero.
            print('  FAIL: template behind root page — the client would ship the old version:')
            for s in stale: print(f'    - {s}')
            print('  Fix: copy the root page over its template, then re-run.')
            TEMPLATE_DRIFT['drift'] = True
        # Keep reusable source page templates in generated clients aligned too;
        # ID Cards' print template now uses the same fixed-mm front/back engine.
        for rel in ['assets/templates/pages/idcards.html']:
            src=GEN/rel
            if src.exists():
                dst=target/rel;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(rebrand(src.read_text(),cfg))
        # V12.61 (#1): the GitHub workflows are part of the shipped product — a
        # generated repo without .github/ silently loses the keep-alive and
        # auto-restore jobs that keep its Supabase project from pausing.
        gh=GEN/'.github'
        if gh.exists():
            for f in gh.rglob('*'):
                if not f.is_file(): continue
                rel=f.relative_to(GEN)
                if rel.as_posix() in ('.github/a',): continue   # upstream marker quirk
                dst=target/rel; dst.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(f,dst)
        print(f'Synchronised {target}')
if __name__=='__main__':
    import sys
    main()
    if TEMPLATE_DRIFT['drift']:
        print('\nTEMPLATE DRIFT: a page template is behind its root page.')
        print('The client would ship an older version of that page. Failing.')
        sys.exit(1)
