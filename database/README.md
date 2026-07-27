# School Connect V5.6.1 database installation

## Only production SQL

Back up Supabase, then run the entire **`complete-schema.sql`**. It is the single
cumulative installer for a new project or any existing School Connect database.
It contains every V5.1–V5.6.1 table, compatibility column, repair, constraint,
index, trigger, view, RLS policy, grant and RPC. It is safe to run repeatedly;
the release harness executes it twice against the same database.

Wait for this final result:

```text
School Connect V5.6.1 complete cumulative schema installed successfully ✅ — no other production SQL is required
```

Do not run any versioned/focused SQL afterward. Those files remain in source only
as historical narrow-upgrade references and are already included in the complete
schema. Generated clients expose only `complete-schema.sql` as production SQL.

## Demo-only exception

In a separate demo project only:

1. Run `complete-schema.sql`.
2. Create the five Authentication users in `DEMO-SETUP.md`.
3. Run `demo-users.sql`.
4. Run `demo-seed.sql`.

Never run demo SQL in production.

## V5.6.1 repairs included

- Open/multi-subject CBT works without an admission number and never reads an
  unassigned PL/pgSQL record.
- Registered CBT still enforces official admission identity and roster access.
- Demo roster/admission-letter inserts use `v_exam_id` and qualified aliases,
  eliminating PostgreSQL `42702 exam_id is ambiguous`.
