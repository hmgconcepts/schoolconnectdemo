# Supabase Free-Tier Protection Guide (Zero Cost)

This document outlines multiple **free, automated safeguards** to prevent your Supabase project from pausing after 7 days of inactivity.

## 1. GitHub Actions Heartbeat (Recommended - Already Included)

**File:** `.github/workflows/keep-supabase-alive.yml`

Runs daily and performs a lightweight API call.

**Setup:**
1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add secret: `SUPABASE_ANON_KEY` (your project's anon/public key)

## 2. Supabase Edge Function (Ping) — Included

**Path:** `supabase/functions/ping/index.ts`

Deploy once:
```bash
supabase functions deploy ping
```

Then call it from GitHub Actions or UptimeRobot:
```
https://YOUR-PROJECT.supabase.co/functions/v1/ping
```

## 3. UptimeRobot (Free - Recommended)

1. Go to [uptimerobot.com](https://uptimerobot.com) (free account)
2. Create a new **HTTP(s) Monitor**
3. URL: `https://YOUR-PROJECT.supabase.co/functions/v1/ping`
4. Interval: Every 5 minutes (or daily)
5. This keeps both your Vercel site + Supabase active

## 4. Additional Free Methods

- **Vercel Cron Jobs** (if using Vercel): Add `vercel.json` with scheduled function
- **Cloudflare Workers** (free tier): Lightweight daily ping script
- **GitHub Actions + Edge Function** (already included)

## Combined Recommendation (Best Protection)

Use **all three** together:
1. GitHub Actions (daily)
2. Supabase Edge Function `ping`
3. UptimeRobot (every 5–30 min)

This combination guarantees your project **never pauses** on the free tier.

---
Maintained by HMG Concepts — School Connect Generator