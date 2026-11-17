#!/usr/bin/env bash
# Re-append the fix pack to complete-schema.sql (the pack is authored standalone
# so it can be run on its own in Supabase, then folded into the full schema).
set -euo pipefail
cd "$(dirname "$0")/../.."
MARKER='-- School Connect V12.60 — EXPERT FIX PACK'
LINE=$(grep -n -e "$MARKER" database/complete-schema.sql | head -1 | cut -d: -f1)
if [ -z "$LINE" ]; then echo "marker not found"; exit 1; fi
# the banner rule sits on the line above the marker
HEAD=$(( LINE - 2 ))
head -n "$HEAD" database/complete-schema.sql > /tmp/sc-head.sql
cat /tmp/sc-head.sql database/v12.60-expert-fix-pack.sql > database/complete-schema.sql
echo "complete-schema.sql rebuilt: $(wc -l < database/complete-schema.sql) lines (pack starts at line $((HEAD+1)))"
