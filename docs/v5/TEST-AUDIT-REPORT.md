# School Connect V5.6.1 — Test and Audit Report

**Audit date:** 2026-07-27 (Africa/Lagos)

## Automated results

| Suite | Result |
|---|---:|
| V5.6.1 SQL/link/parity/security contract audit | 79 passed, 0 failed |
| Complete schema executed twice | passed; same database, no re-run failure |
| Complete-schema focused RPC coverage | every retained focused-upgrade RPC included; one authoritative definition per function |
| Focused DDL coverage | every retained focused-upgrade table, column and index included |
| Static client RPC coverage | all 19 named RPC calls exist in complete schema |
| Open multi-subject V6 getter | blank admission accepted; `ok=true`, `candidate=null`, questions returned |
| Full demo users + seed executed twice | passed; no ambiguous `exam_id`; roster/admission letters populated |
| CBT UTME tab simulation | 9 passed, 0 failed |
| CBT browser scoring/parser unit tests | 11 passed, 0 failed |
| Registered CBT admission-only identity | admission required; official name/class enforced in getter and saved result |
| Executed V5.1 SQL grading engine (PGlite) | 10/10, 100%, 5 correct; idempotence, historical regrade, redaction and missing-key guard passed |
| Report output, flexible headings, teacher signature and CBT-only adaptive tests | 7 passed, 0 failed |
| Bulk CBT → canonical report_scores tests | 4 passed, 0 failed |
| Timetable PostgreSQL-compatible engine test | 5/5 demands placed; restricted days and cross-class teacher conflicts passed |
| Exact demo numeric `amount` insert test | 12 module rows inserted into numeric column; passed |
| Data portability JSON/CSV round-trip | 5 passed, 0 failed |
| Teacher subject/class scope SQL test | own subject/class allowed; foreign records denied; non-owner CBT clear denied |
| Demo coverage audit | 80/80 CRUD modules plus 16 specialised datasets covered |
| Sample/receipt/fee workflow regression | 12 passed, 0 failed |
| Role-navigation regression | passed |
| Generator packaging contract | passed |
| Traditional real JSZip build | 184 entries; 0 broken links; 0 orphans |
| Modern real JSZip build | 389 entries; 0 broken links; 0 orphans |
| PostgreSQL parsing | complete schema 1,156 statements; demo seed 40 top-level statements |
| Demo seed/schema column contract | 0 missing tables/columns |
| Shared runtime parity across generator/GOSA/demo | passed |

Run everything from the generator repository:

```bash
./verify.sh
```

## Tested CBT cases

- Correct answer stored as letter, candidate submits letter.
- Correct answer stored as letter, candidate equivalent option text.
- Correct answer stored as option text, candidate submits letter.
- `true-false` alias normalisation and letter/text equivalence.
- Numeric tolerance pass/fail.
- Multi-select exact set, order-independent; partial set rejected.
- Mixed question grading totals 100% when all answers are correct.
- Subject breakdown recovers two stable subject groups.
- Random/shuffled payload carries original bank index.
- Static server contract verifies canonical and v2 paths use the fixed matcher.

## Tested document cases

- Grade thresholds match the supplied samples.
- Student report includes school identity, score table, affective and psychomotor domains, comments, assigned class-teacher name/signature and stamp.
- CBT-only report uses only the active CBT maximum; absent manual CA/exam cells print as dashes.
- Class broadsheet has rotated subject headings, totals, averages, positions and grading legend.
- Subject broadsheet has average, high, low and pass-rate statistics plus sign-off.
- Receipt has header/logo/contact, reference/date/student/term/method, total, amount paid, remaining/full-paid state and authorised signature.

## Workflow audit

- Generator rich templates no longer drift from critical reference pages.
- All three repositories share identical CBT/report/CRUD/help engines and canonical schema/seed.
- Static local links resolve in generator, GOSA and demo.
- Candidate exam is network-first after tab repair and retains offline fallback.
- Service-worker/cache headers force updated grading code to replace old cached assets.
- Demo records cover core, academic, finance, communication and enterprise pages.
- Complete schema and complete demo seed are each executed twice by the maintained harness.
- Generated clients expose one production SQL path; demo mode adds only the two demo-only SQL files.

## Security audit notes

- Public question getter strips top-level answer/explanation keys.
- Browser-supplied marks are not trusted by canonical SQL scorer.
- Submission retries use client-reference idempotency.
- Role/page checks complement RLS; they do not replace it.
- No paid AI API endpoint/key dependency was detected.
- Public Supabase anon keys are expected; service-role keys must never be committed.

## Boundaries of this audit

- No owner/service-role credentials were supplied, so the repaired SQL was syntax/contract tested but not applied to the user’s live projects by this agent.
- The live authenticated pages could not be exercised as real roles without account credentials.
- Visual output structure was regression-tested; printer/browser-specific pagination should still be accepted on the school’s actual devices.
- Provider free-tier concurrency and quotas require a deployment-specific load test.

## Manual acceptance required after deployment

Use the checklist in `DEPLOYMENT-GUIDE-V5.md`, particularly a disposable live CBT with mixed answer-key formats, a repaired old multi-subject exam, all five demo roles and four printed outputs.
