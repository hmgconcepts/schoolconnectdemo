# Database installation

Run **`complete-schema.sql`** once in the Supabase SQL Editor. It is the single,
self-contained, dependency-ordered, idempotent v12 schema for a **fresh** deployment —
and it also **repairs** older School Connect databases (missing tables, columns, unique
keys, policies) without touching your data.

## CBT V5.1 zero-score repair

For an **existing** database where correct CBT attempts are stored as zero, back up
Supabase and run `cbt-v5.1-zero-score-hotfix.sql`, then deploy the matching V5.1
`cbt-exam.html`, `cbt.html`, `cbt-multi.html` and `assets/js/cbt-engine.js` files.
If the V5 getter reports `column "motto" does not exist`, run the small
`cbt-v5.1.1-getter-school-settings-fix.sql`; the updated main CBT hotfix and
complete schema already contain it. The getter now reads optional settings through
`to_jsonb()` so schema
drift cannot abort an otherwise valid exam.

The hotfix is executed against an embedded PostgreSQL-compatible engine by
`tools/test-cbt-sql-engine.mjs`: mixed legacy key names score 10/10, retries are
idempotent, public questions contain no answer aliases, and a missing key fails
loudly instead of saving a false zero. Fresh projects only need the complete schema.

> **Self-sufficiency contract (V5.1):** apart from the two optional demo packs
> (`demo-users.sql`, `demo-seed.sql` — demo deployments only), `complete-schema.sql`
> is the **ONLY** SQL a School Connect deployment ever needs. Every table,
> constraint, index, policy, trigger, view and **every RPC the client code calls**
> (all 16, machine-enumerated) is inside it. The standalone packs below exist
> **only** to bring *already-live* older projects up to date without a full re-run.

# School Connect database files

## Authoritative V5.6 deployment rule

Back up the project, then run **`complete-schema.sql`** for a fresh install or any cumulative upgrade. It contains all V5.1–V5.6 changes and reloads the PostgREST schema cache. Do not run demo data in production, and do not deploy the V5.6 frontend without its SQL.

Files:
- `complete-schema.sql` — authoritative fresh install and cumulative V5.6 upgrade.
- `cbt-v5.1-zero-score-hotfix.sql` — focused legacy CBT scoring repair only.
- `cbt-v5.1.1-getter-school-settings-fix.sql` — focused getter repair for databases lacking `school_settings.motto`.
- `v5.3-platform-enhancements.sql` — focused teacher-signature/timetable upgrade.
- `v5.4-portability-cbt-metrics.sql` — focused student term-metrics upgrade.
- `v5.5-registered-cbt-identity.sql` — focused admission-only registered CBT identity upgrade.
- `v5.6-daily-fees-cbt-reset-teacher-scope.sql` — focused V5.6 pack, only for an otherwise fully current V5.5 database.
- `demo-users.sql` / `demo-seed.sql` — synthetic demo accounts/data for a separate demo project only.
- `*.csv` — import templates and sample question banks.

The concurrency, punctuality and runtime-helper functionality described below is already incorporated into `complete-schema.sql`; this V5.6 package does not require separate SQL packs for those features.

## v12.5 patch — runtime-RPC contract completion + self-sufficiency (2026-07-23)
Section 18 ships every RPC the client code can call, so **no deployment ever needs a
secondary SQL file or a hand-created dashboard function again**: `sc_current_role()`
(one-call profile/role fetch), `lookup_login_email(identifier)` (sign in with email,
phone, admission no or staff no), `notif_mark_read(id)` (idempotent per-user read
receipts), `table_sizes()` (storage meter incl. `TOTAL_DATABASE_USED` row),
`purge_old(table, days)` (whitelist-guarded admin cleanup), `submit_admission(jsonb)`
(apply-form intake), `extract_admission(id)` (one click admission → student, with the
auto `SCH-00001` admission-number trigger), `generate_timetable(class, session, term,
periods/day)` (weekday round-robin from `timetable_requirements`, replace-clean
regeneration — an infinite-loop flaw in the first draft was caught by the harness and
fixed), and `cbt_import_backup(jsonb)` (teacher-side import of offline exam backups:
same server-authoritative, shuffle-safe grading as `cbt_submit_v2`, minus the
exam-window/attempt gates, idempotent on `client_ref`). Section 18.0 also force-adds
the `admissions.photo_url / data / extracted` columns older schemas silently lacked.
Also hardened this round: the question-source selector used by
`cbt_get_public_exam`, `cbt_submit`, `cbt_get_public_exam_v2`, `cbt_submit_v2` and
`cbt_import_backup` now picks the first **non-empty** bank
(`csv_data` → `questions` → `[]`) instead of a bare `coalesce`, which could never
reach the legacy `questions` column (it is `NOT NULL DEFAULT '[]'`). Legacy
questions-only exams now render and grade correctly end-to-end. Grants are
least-privilege (`revoke … from public, anon` / `grant … to authenticated`;
`lookup_login_email` additionally granted to `anon` because login happens pre-auth).
All client call sites keep their graceful fallbacks, so these functions are pure
hardening on older client builds and instantly live on new ones. For current deployments, use the cumulative `database/complete-schema.sql`; no separate helper pack is required.

## v12.4 patch — Punctuality Points engine + results-columns fix (2026-07-23)
Section 17 of the schema ships the punctuality engine: `punctuality_config`
(editable rule: first check-in ≤ deadline AND last checkout ≥ closing → points),
`punctuality_awards` (unique per student+date, re-gradeable),
`compute_punctuality_awards(date, class)` and
`sc_push_punctuality_to_results(term, session, column, class, range)` — an
IDEMPOTENT upsert into `results` (deterministic `assessment_ref`,
information_schema-validated numeric column, manual rows never matched). This
run also force-adds the four enhanced `results` columns (`student_id_ref`,
`student_name`, `assessment_source`, `assessment_ref`) + `results_assessment_uidx`,
fixing a latent 42703 the punctuality/CTB pushes could hit on databases installed
fresh from earlier v12.x builds. For current deployments, use the cumulative `database/complete-schema.sql`; no separate punctuality pack is required.

## v12.3 patch — CBT 1000-concurrent scale pack (2026-07-23)
Section 16 of the schema now ships the scale pack: submissions are IDEMPOTENT
(a retry after a network drop returns the original result instead of a
duplicate), grading stays 100% server-side and is shuffle-safe (graded by each
question's `_orig_index`, not screen position), attempt limits and the exam
close-window are enforced by the database, and the exam page syncs its clock to
the server. The client needs no changes and falls back to the v1 functions on
older schemas. For current deployments, use the cumulative `database/complete-schema.sql`; no separate scale pack is required.

## v12.1 patch — 42703 "column student_id does not exist" (2026-07-22)
If you saw `ERROR: 42703: column "student_id" does not exist` while running
`complete-schema.sql` on an EXISTING database, your database was built by an
older schema generation whose tables (e.g. `support_plans`, `certificates`,
`lms_submissions`, `idcards`, `results.teacher_id`, `poll_votes.candidate_id`,
`profiles.role/status`, …) pre-date the hardening added in v12. RLS policies
validate their column references at creation time, so the run aborted.
v12.1 extends the drift-hardening block: every column referenced by any
policy / view / function / constraint / index is now force-added
(`ADD COLUMN IF NOT EXISTS`) before first use. Just re-run the updated
`complete-schema.sql` — it is idempotent and purely additive; nothing is
dropped from your database.
