# 🚀 Deployment Guide — School Connect Demonstration College

This guide walks you from a freshly downloaded ZIP to a **live, working school
portal** in about 15 minutes, using only **free tools** (Supabase free tier +
free static hosting). No credit card. No monthly fees. No AI APIs.

> Read every step in order. Each step says exactly what to click and type.

---

## ✅ Before you start — what you need
- A computer with a web browser (Chrome or Edge recommended).
- A free **GitHub** account (https://github.com/signup) — for hosting.
- A free **Supabase** account (https://supabase.com) — for the database & login.
- This ZIP, fully **unzipped** into a folder you can find.

---

## STEP 1 — Create your free database (Supabase)

1. Go to **https://supabase.com** → click **Start your project** → sign in with GitHub.
2. Click **New project**.
   - **Name:** SCD
   - **Database Password:** click *Generate a password* and **save it somewhere safe**.
   - **Region:** pick the one closest to your school.
   - Click **Create new project** and wait ~2 minutes for it to finish provisioning.

## STEP 2 — Install the database tables (run the SQL)

1. In the left sidebar of your Supabase project, click **SQL Editor**.
2. Click **+ New query**.
3. Run this **ONE file** (open it from this ZIP, copy all, paste, Run):
   **`database/complete-schema.sql`** → success banner
   `School Connect v12.5 clean schema installed successfully ✅ (CBT scale pack +
   Punctuality Points engine + all runtime helper RPCs included — fully self-contained)`.
   It installs **everything**: all tables, RLS policies, triggers, views, the CBT
   engine + question contracts, voting, report cards, enterprise tables, the
   Punctuality Points engine, and **all 16 RPCs** the app calls.
   - ✅ **Self-contained & idempotent** — run it once; safe to re-run. Apart from the
     optional demo packs (`demo-users.sql`, `demo-seed.sql`), it is the **only** SQL
     your deployment ever needs.
   - ❌ Do **not** run the smaller feature packs (`cbt-1000-scale.sql`,
     `punctuality-points.sql`, `runtime-helper-rpcs.sql`) on a fresh install — each is
     already inside the complete schema; they exist only to upgrade *older live*
     projects without a full re-run.
4. Click **Run** (or press Ctrl/Cmd+Enter).
5. The CBT engine and report cards are now installed and **interconnected** — when a
   student takes an online exam that is mapped to a report-card column, the score
   flows automatically into the report card.
   - ❌ If you ever see `relation "public.profiles" does not exist`, you are
     running an **old** SQL file. Use the `database/complete-schema.sql` from
     THIS ZIP — it is dependency-ordered, so that error can no longer happen.

## STEP 3 — Get your API keys

1. In Supabase, click the **gear / Project Settings** (bottom-left) → **API**.
2. Copy two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string starting with `eyJ...`)

## STEP 4 — Paste your keys into the app

1. Open **`assets/js/config.js`** from this ZIP in a text editor.
2. Find these two lines near the top and replace the placeholders:
   ```js
   window.SUPABASE_URL = 'YOUR_SUPABASE_URL';        // paste Project URL here
   window.SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';   // paste anon public key here
   ```
3. **Save** the file. (The anon key is safe to ship publicly — Row-Level
   Security on the database is what actually protects your data.)

## STEP 5 — Turn on email confirmations (recommended)

1. In Supabase → **Authentication** → **Providers** → make sure **Email** is enabled.
2. Authentication → **URL Configuration** → set **Site URL** to the address where
   you will host the site (from Step 6). You can update this later.

## STEP 6 — Put the site online (free hosting)

Pick ONE of these (all free):

### Option A — GitHub Pages (recommended, easiest)
1. Create a new repository at https://github.com/new (e.g. `god-of-seed-academy-portal`), set it **Public**, click **Create**.
2. On the repo page click **Add file → Upload files**, then drag in **ALL** the
   unzipped files and folders (keep the folder structure), and **Commit**.
3. Go to **Settings → Pages**. Under *Build and deployment* → *Source* choose
   **Deploy from a branch**, branch **main**, folder **/ (root)**, click **Save**.
4. Wait ~1 minute. Your live URL appears at the top: `https://USERNAME.github.io/REPO/`.

### Option B — Netlify Drop (no account-setup needed)
1. Go to **https://app.netlify.com/drop**.
2. Drag your **unzipped folder** onto the page. It deploys instantly and gives you a URL.

### Option C — Cloudflare Pages / Vercel
1. Connect your GitHub repo and deploy as a **static site** (no build command, output = root).

> You chose the **TRADITIONAL (static)** build — there is no build step. Just upload the files.

## STEP 7 — Create the first admin account

1. Open your live site and click **Sign in → Request access**.
2. Fill the form (use your real email), choose role **Admin**, submit, and
   **confirm the email** Supabase sends you.
3. Go back to Supabase → **SQL Editor** → run this (use YOUR email):
   ```sql
   update public.profiles
      set role = 'admin', status = 'approved'
    where email = 'your-email@example.com';
   ```
4. Return to the site and **Sign in**. You now have full admin access. 🎉

---

## 🔧 Quick checklist
- [ ] Supabase project created
- [ ] `database/complete-schema.sql` run → v12.5 success message shown
- [ ] URL + anon key pasted into `assets/js/config.js`
- [ ] Site uploaded to free hosting and opens in a browser
- [ ] First user registered, promoted to admin via SQL, and able to log in

If anything goes wrong, open **TROUBLESHOOTING.md** in this ZIP.

Powered by HMG Concepts — https://hmgconcepts.pages.dev/


## School Connect v1 Final Deployment Note
Run `database/complete-schema.sql` once in Supabase SQL Editor for a fresh deployment. It is now cumulative and self-contained: it includes base schema, CBT, voting, report cards, enterprise tables, class fee structures, product store, status audit log, parent-child access policies, staff check-in deadline settings, and schema-cache reload notifications. The smaller update SQL files are retained only for upgrading older deployed clients.

---

> ## ⚠️ V12 IMPORTANT UPDATE (this build)
> The database layer was **rebuilt** into ONE clean, dependency-ordered, idempotent file:
> **`database/complete-schema.sql`** (v12). Guides below that say "run the schema" refer to
> exactly that file — paste it once into the Supabase SQL Editor and run. It also **repairs**
> older deployments (missing tables/columns/unique keys) and reloads the API schema cache,
> eliminating all "table not found in schema cache" and "ON CONFLICT" errors permanently.
> The former merged file is kept for reference as `database/complete-schema-v11-LEGACY-MERGED.sql`.
> Do not run legacy/migration SQL files after the v12 schema — they are superseded.
