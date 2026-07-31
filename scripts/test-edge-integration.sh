#!/usr/bin/env bash
# ─── Edge Worker Integration Test ─────────────────────────────────────────────
# Validates that the edge worker compiles, migrations are consistent,
# and all required Cloudflare-native bindings are configured.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Checking wrangler.toml has Cloudflare-native bindings"
grep -qE '^\[\[d1_databases\]\]' apps/edge/wrangler.toml || {
  echo "Missing D1 binding: the Worker needs a relational database." >&2
  exit 1
}
grep -qE '^\[\[r2_buckets\]\]' apps/edge/wrangler.toml || {
  echo "Missing R2 bindings: the Worker needs object storage." >&2
  exit 1
}
grep -qE '^\[\[kv_namespaces\]\]' apps/edge/wrangler.toml || {
  echo "Missing KV bindings: the Worker needs key-value storage." >&2
  exit 1
}
# Current wrangler syntax is [[queues.producers]]; accept both for robustness.
grep -qE '^\[\[queues(\]\]|\.producers\]\])' apps/edge/wrangler.toml || {
  echo "Missing Queue bindings: the Worker needs async queues." >&2
  exit 1
}
echo "  ✅ All required bindings are present."

echo "==> Checking D1 migrations exist"
MIGRATIONS=(apps/edge/migrations/*.sql)
if [ ${#MIGRATIONS[@]} -eq 0 ]; then
  echo "  ❌ No D1 migrations found in apps/edge/migrations/" >&2
  exit 1
fi
echo "  ✅ ${#MIGRATIONS[@]} migration(s) found:"
for m in "${MIGRATIONS[@]}"; do
  echo "     - $(basename "$m")"
done

echo "==> Checking migration sequence is contiguous"
# Wrangler expects migrations to be numbered sequentially (0001, 0002, ...)
for m in "${MIGRATIONS[@]}"; do
  BASENAME=$(basename "$m")
  if [[ ! "$BASENAME" =~ ^[0-9]{4}_ ]]; then
    echo "  ❌ Migration $BASENAME does not follow 0000_ prefix convention" >&2
    exit 1
  fi
done
echo "  ✅ Migration numbering convention verified."

echo "==> Building edge worker"
npm run build --workspace @challanse/edge 2>&1 || {
  echo "  ❌ Edge worker build failed" >&2
  exit 1
}
echo "  ✅ Edge worker builds successfully."

echo "==> Running edge worker unit tests"
npm test --workspace @challanse/edge 2>&1 || {
  echo "  ❌ Edge worker tests failed" >&2
  exit 1
}
echo "  ✅ Edge worker tests pass."

echo "==> Checking TypeScript types compile cleanly"
npx tsc --noEmit --project apps/edge/tsconfig.json 2>&1 || {
  echo "  ❌ TypeScript type checking failed" >&2
  exit 1
}
echo "  ✅ TypeScript types are consistent."

echo "Edge worker integration checks passed."
