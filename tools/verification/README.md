# V12.60 verification harnesses

These scripts reproduce each reported bug and prove the fix against a real
PostgreSQL engine (PGlite), with no Supabase project required.

Run them from the repository root (they resolve `node_modules` from there):

```bash
node tools/verification/tmp-testpack.mjs     # full schema + fix pack install
node tools/verification/tmp-idempotent.mjs   # schema and pack both run twice
node tools/verification/tmp-verify-pack.mjs  # reproduces & proves all eight fixes
node tools/verification/tmp-repro1.mjs       # the original CBT UUID/code repro
```

Expected output of `tmp-verify-pack.mjs` (abridged):

```
BUG1 mirror drive_link: ./cbt-exam.html?code=4NTJNC | is_cbt: true
BUG1 student takes via link code 4NTJNC => { ok: true, questions: 2 }
BUG1 legacy uuid link still opens: { ok: true, code: '4NTJNC', questions: 2 }
FEE after paying 20000: bill=60000 paid=20000 balance=40000 ... TOTAL_DUE=40000
FEE fully paid: { paid: 60000, total_due: 0, status: 'paid' }
ROSTER debtors: 1 [ 'Bola Ade' ]      ROSTER fully paid: 1 [ 'Ada Obi' ]
BULK LOCK via one call: { ok: true, kind: 'portal', locked: true, updated: 1 }
FLAG resolve award_all: { ok: true, mark: 1, affected_results: 1 }
SCORE after resolution: { score: '2.00', total: '2.00', percent: '100.00' }
MIDTERM publish-all: { ok: true, classes: 3, generated: 4 }
```
