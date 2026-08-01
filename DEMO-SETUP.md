# Demo Deployment Guide — School Connect Demonstration College

This ZIP is a **DEMO build**: it lets prospective clients explore a complete,
fully-simulated school instantly — no sign-up or data entry needed.

## What is inside
- Everything a production School Connect ZIP contains.
- `database/demo-users.sql` (**v6, adopt-only**) — heals the five guest
  accounts' portal profiles to the correct role + approved status (this is the
  fix for the "Account pending approval" screen) and confirms the emails.
  It deliberately creates NO auth users and touches NO passwords — see
  "Hard-won rules" below.
- `database/demo-seed.sql` — a complete simulated school: 18 students,
  8 staff, parent links, fee structures & payments, attendance, check-ins,
  results + report-card columns/scores/comments/traits, a published CBT exam
  with real questions + submissions, polls, announcements, gallery, diary,
  conduct, health, assignments, lesson plans, survey, leave, visitors,
  helpdesk, hostel, staff clock-ins, timetable data, shop products and ID cards.
- `assets/js/demo.js` — renders the one-tap "Explore as Guest" panel on the
  login page and the slim demo ribbon everywhere else.

## Guest logins (also shown on the login page)
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@scdemo.school | Demo#Admin1 |
| Teacher | teacher@scdemo.school | Demo#Teach1 |
| Parent | parent@scdemo.school | Demo#Parent1 |
| Student | student@scdemo.school | Demo#Study1 |
| Bursar | bursar@scdemo.school | Demo#Bursar1 |

## Deploy in 7 steps (~10 minutes, 100% free tier)
1. Create a free Supabase project → open its **SQL Editor**.
2. Run **database/complete-schema.sql** once (self-contained, idempotent).
3. Create the five guest accounts: Dashboard → **Authentication → Users →
   "Add user"** × 5 with the emails + passwords in the table above and
   **"Auto Confirm User" ON**. (~1 minute. This is the ONLY supported way —
   see the rules below.)
4. Run **database/demo-users.sql** v6 once → approves the five profiles
   (kills the "Account pending approval" screen) and confirms the emails.
   It FAILS VISIBLY if any account from step 3 is missing.
5. Run **database/demo-seed.sql** once → loads the simulated school
   (links everything to the accounts BY EMAIL; also works with zero
   accounts — links appear once accounts exist).
6. Edit **assets/js/config.js**: paste your Supabase URL + anon key.
7. Host the folder anywhere free — Vercel / Netlify / GitHub Pages /
   Cloudflare Pages — and share the link with your prospect.

## Hard-won rules (probed live on the newest hosted GoTrue, 2026-07-23)
1. **Dashboard "Add user" does NOT validate email domains** — @scdemo.school
   works fine and never touches a real inbox.
2. **Password login does NOT validate domains either** — Dashboard-created
   @scdemo.school accounts sign in with JWTs. Only the PUBLIC SIGNUP API
   validates domains, and demo guests never sign up — they log in.
3. **SQL-created auth rows cannot log in** on these projects ("Invalid login
   credentials"), no matter how careful the INSERT — that is why v6 creates
   none. Older script versions (v1–v5) that create users in SQL must not be
   used for account creation.
4. **SQL-written passwords break healthy Dashboard accounts** — v6 never
   touches passwords. Set/repair them in Dashboard → Users → Edit user.
5. Dashboard "Add user" failing with **"Database error checking email" /
   "finding user"** means the email ALREADY EXISTS as a row GoTrue cannot
   parse (an old SQL script created it). It is NOT a domain rejection. Fix:
   delete that row (Dashboard → Users → ⋯ → Delete user), re-add natively,
   run v6.
6. The signup trigger defaults every new profile to *pending student* —
   the "Account pending approval" screen. v6 cures exactly that.

## Troubleshooting: "Demo login failed"
The login panel shows the *real* error with a matching fix. In short:
| Error text | Cause → Fix |
|---|---|
| "Account pending approval" | Profiles defaulted to pending student → run **demo-users.sql v6** once. |
| `Invalid login credentials` | Account missing or password differs → Dashboard → Users → create it, or **Edit user → set password** to the table above (Auto Confirm ON), then v6. |
| `Database error querying schema` / `unexpected_failure` (500) | A leftover SQL-created row from demo-users.sql v1–v5 → Dashboard → Users → **delete** it, re-add natively (Auto Confirm ON), run v6. |
| `Failed to create user: Database error checking email` (Dashboard) | Same thing: the email already exists as an unreadable SQL row → delete it first, then Add user. |
| `Email not confirmed` | → re-run v6 (confirms), or Dashboard → Edit user → Confirm email. |
| `Failed to fetch` / network | → wrong SUPABASE_URL / anon key in `assets/js/config.js`. |
| project paused / 503 | → free projects pause after ~7 idle days: Supabase dashboard → **Restore project**. |
| Public "sign up" rejects an email | Expected on fake domains (signup API validates domains) — visitors should use the five guest logins above, not sign up. |

Quick health check (SQL Editor — should return 5 rows, all confirmed +
approved):
```sql
select u.email, (u.email_confirmed_at is not null) as confirmed, p.role, p.status
  from auth.users u left join public.profiles p on p.id = u.id
 where u.email like '%@scdemo.school' order by u.email;
```

## Refreshing / resetting the demo
All three SQL files are idempotent — re-running demo-seed.sql only tops up
what is missing (it never deletes rows visitors created). To reset completely:
Supabase → **Table Editor** → delete rows from the transactional tables
(students, staff, results, fee_payments, attendance, cbt_results, …) and
re-run demo-seed.sql.

## Notes for HMG
- Demo data is synthetic; banners remind visitors not to enter real data.
- The demo build runs the same license engine as production; demo deployments
  are generated with a **lifetime demo license** so they never lock.
- All guest accounts are ordinary rows in `auth.users` + `profiles`; you can
  suspend them any time on the Approvals page.


## Rich sample data on EVERY page (30 seconds)
Three interchangeable ways — pick any:
1. **SQL (recommended, guaranteed):** SQL Editor → paste `database/demo-sample-data.sql` → Run. Fills payroll, inventory, application links, messages, assignments, behaviour points, support plans, library, help-desk, bonuses, gamification, cafeteria, lost & found and PTA. Idempotent — safe to re-run.
2. **Automatic:** on demo deployments the same pack loads itself the first time an admin/teacher opens any page each day.
3. **One click:** Admin Data → 🎬 One-Click Demo Sample Data.
