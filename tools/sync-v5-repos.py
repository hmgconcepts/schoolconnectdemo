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
TARGETS={
    ROOT/'generated-sites'/'gosa': dict(name='God of Seed Academy',short='GoSA',motto='Excellence in Learning and Character',address='63B, Ishaga Abosule Street, Agbado Crossing, Ogun State',phone='2348088667076',email='godofseedacademy@gmail.com',ext='png'),
    ROOT/'demo-site': dict(name='School Connect Demonstration College',short='SCD',motto='A fully simulated school — explore every feature',address='HMG Demo Campus, Lagos, Nigeria',phone='+234 810 086 6322',email='buildingmyictcareer@gmail.com',ext='svg'),
}
RUNTIME=[
 'assets/css/style.css','assets/js/app.js','assets/js/analytics.js','assets/js/cbt-engine.js','assets/js/chatbot.js',
 'assets/js/crud.js','assets/js/demo.js','assets/js/enterprise.js','assets/js/license.js',
 'assets/js/notifications.js','assets/js/data-portability.js','assets/js/v57-enhancements.js','assets/js/pwa-install.js','assets/js/report-engine.js',
 'assets/js/site-help.js','assets/js/super.js','assets/js/voting.js',
 'database/complete-schema.sql','database/cbt-v5.1-zero-score-hotfix.sql','database/cbt-v5.1.1-getter-school-settings-fix.sql','database/v5.3-platform-enhancements.sql','database/v5.4-portability-cbt-metrics.sql','database/v5.5-registered-cbt-identity.sql','database/v5.6-daily-fees-cbt-reset-teacher-scope.sql','database/demo-seed.sql','database/demo-users.sql',
 'database/README.md','assets/img/demo-signature.svg','CBT_AND_REPORTCARD_GUIDE.md','DEPLOYMENT-GUIDE.md'
]
RICH=['cbt-exam.html','cbt-multi.html','cbt.html','report-cards.html','student-profile.html','academic-records.html','profile.html','timetable-generator.html','admin-data.html','storage.html','health.html','login.html','change-password.html','forgot-password.html','rubrics.html','transcripts.html','analytics.html','fees.html','settings.html','entrance.html','exam-register.html','academic_setup.html','certificates.html','admissions.html','approvals.html','diary.html','digital_library.html','sow.html']

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
    text=re.sub(r'assets/img/logo\.(?:png|jpe?g|webp|svg)',f"assets/img/logo.{cfg['ext']}",text)
    return text

def main():
    for target,cfg in TARGETS.items():
        if not target.exists(): raise SystemExit(f'Missing target: {target}')
        for rel in RUNTIME:
            src=GEN/rel
            if src.exists():
                dst=target/rel; dst.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src,dst)
        for rel in RICH:
            src=GEN/rel; (target/rel).write_text(rebrand(src.read_text(),cfg))
        print(f'Synchronised {target}')
if __name__=='__main__': main()
