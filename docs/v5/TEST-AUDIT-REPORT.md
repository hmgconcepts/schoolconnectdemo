# School Connect V5.7 — Test and Audit Report

**Audit date:** 2026-07-27 (Africa/Lagos)

| Suite | Result |
|---|---:|
| Main SQL/link/parity/security audit | 83 passed, 0 failed |
| V5.7 professional feature audit | 16 passed, 0 failed |
| Complete schema repeat execution | 2 runs passed on same database |
| PostgreSQL parse | 1,220 schema statements; 44 demo statements |
| Complete schema | 100 public tables; one authoritative function definition each |
| Client RPC contract | 22/22 present |
| Public campaign getter/submission | passed; reference generated |
| Performance comment demo bands | 6 |
| Role navigation | 8 roles tested; owner/leadership/bursar/family scopes passed |
| Inline JavaScript | 335 blocks, 0 failures |
| CBT tabs | 9/9 |
| CBT parser/scoring | 11/11 |
| SQL CBT grading | 10/10, 100%; registered/open identity passed |
| Report output | 7/7 |
| Bulk CBT report push | 4/4 |
| Timetable engine | 5/5 placed; availability/conflict checks passed |
| Data portability | 5/5 |
| Sample/receipt workflows | 12/12 |
| Demo coverage | 80/80 CRUD modules + 16 specialised datasets + V5.7 datasets |
| Traditional generated ZIP | 185 entries; 0 broken links; 0 orphans |
| Modern generated ZIP | 391 entries; 0 broken links; 0 orphans |

The complete schema and full demo seed were each executed twice. Public registration,
open multi-subject CBT and role-navigation paths were executed/static-regression tested.
Live authenticated role acceptance must still be performed after deploying to the
owner's Supabase/Vercel projects because credentials were not provided to this agent.
