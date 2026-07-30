#!/usr/bin/env bash
# ─── ChallanSe Cloudflare Resource Bootstrap ────────────────────────────────
# Creates D1 databases, R2 buckets, KV namespaces, and Queues.
# Requires: wrangler CLI, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#
# Usage: bash scripts/setup-cloudflare.sh [--preview]
#   --preview  Creates preview resources for local development

set -euo pipefail

PREFIX="${1:+preview-}"

echo "==> Bootstrapping Cloudflare resources (prefix: ${PREFIX:-production})"

# ─── D1 Database ────────────────────────────────────────────────────────────
echo "==> Creating D1 database: ${PREFIX}challanse-core"
npx wrangler d1 create "${PREFIX}challanse-core" 2>&1 | tee /tmp/challanse-d1-create.log
D1_ID="$(grep -oP 'database_id = "\K[^"]+' /tmp/challanse-d1-create.log || true)"

if [ -n "$D1_ID" ]; then
  echo "  D1 database_id: $D1_ID"
  echo "  Add to wrangler.toml: database_id = \"$D1_ID\""
  # Store in .cloudflare-resources for CI
  mkdir -p .cloudflare
  echo "D1_DATABASE_ID=$D1_ID" >> .cloudflare/resources.env
fi

# ─── R2 Buckets ─────────────────────────────────────────────────────────────
echo "==> Creating R2 bucket: ${PREFIX}challanse-receipts"
npx wrangler r2 bucket create "${PREFIX}challanse-receipts" || echo "  Bucket may already exist"

echo "==> Creating R2 bucket: ${PREFIX}challanse-audit-exports"
npx wrangler r2 bucket create "${PREFIX}challanse-audit-exports" || echo "  Bucket may already exist"

# ─── KV Namespaces ─────────────────────────────────────────────────────────
echo "==> Creating KV namespace: ${PREFIX}challanse-sessions"
npx wrangler kv namespace create "${PREFIX}challanse-sessions" 2>&1 | tee /tmp/challanse-kv-sessions.log
SESSIONS_ID="$(grep -oP 'id = "\K[^"]+' /tmp/challanse-kv-sessions.log || true)"
if [ -n "$SESSIONS_ID" ]; then
  echo "  SESSIONS KV id: $SESSIONS_ID"
  echo "SESSIONS_KV_ID=$SESSIONS_ID" >> .cloudflare/resources.env
  echo "SESSIONS_KV_PREVIEW_ID=$SESSIONS_ID" >> .cloudflare/resources.env
fi

echo "==> Creating KV namespace: ${PREFIX}challanse-config"
npx wrangler kv namespace create "${PREFIX}challanse-config" 2>&1 | tee /tmp/challanse-kv-config.log
CONFIG_ID="$(grep -oP 'id = "\K[^"]+' /tmp/challanse-kv-config.log || true)"
if [ -n "$CONFIG_ID" ]; then
  echo "  CONFIG KV id: $CONFIG_ID"
  echo "CONFIG_KV_ID=$CONFIG_ID" >> .cloudflare/resources.env
  echo "CONFIG_KV_PREVIEW_ID=$CONFIG_ID" >> .cloudflare/resources.env
fi

echo "==> Creating KV namespace: ${PREFIX}challanse-rate-limits"
npx wrangler kv namespace create "${PREFIX}challanse-rate-limits" 2>&1 | tee /tmp/challanse-kv-rate.log
RATE_ID="$(grep -oP 'id = "\K[^"]+' /tmp/challanse-kv-rate.log || true)"
if [ -n "$RATE_ID" ]; then
  echo "  RATE_LIMITS KV id: $RATE_ID"
  echo "RATE_LIMITS_KV_ID=$RATE_ID" >> .cloudflare/resources.env
  echo "RATE_LIMITS_KV_PREVIEW_ID=$RATE_ID" >> .cloudflare/resources.env
fi

# ─── Queues ─────────────────────────────────────────────────────────────────
echo "==> Creating Queue: ${PREFIX}receipt-enrichment"
npx wrangler queues create "${PREFIX}receipt-enrichment" || echo "  Queue may already exist"

echo "==> Creating Queue: ${PREFIX}audit-events"
npx wrangler queues create "${PREFIX}audit-events" || echo "  Queue may already exist"

# ─── D1 Migrations ──────────────────────────────────────────────────────────
echo "==> Applying D1 migrations"
npx wrangler d1 migrations apply "${PREFIX}challanse-core" || echo "  Migrations may need manual apply"

echo "==> Done! Resources created for ${PREFIX:-production}"
echo "==> Next: Update wrangler.toml with IDs from .cloudflare/resources.env"
echo "==>        Then run: npx wrangler d1 migrations apply challanse-core"
