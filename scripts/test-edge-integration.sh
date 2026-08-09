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

echo "==> Applying D1 migrations to an in-memory SQLite database"
# Regression gate: every migration (0001-0011) must apply cleanly on a real
# SQLite engine. Unit tests never execute this DDL, so column/value mismatches
# like the 0011 upload_sessions_v2 backfill (17 SELECT values for 18 target
# columns, NULL landing on NOT NULL url_path) are only caught here. Also
# verifies seed-d1-pilot.sql applies twice (idempotent).
python3 - <<'PY' || { echo "  ❌ D1 migration application failed" >&2; exit 1; }
import sqlite3, glob, os, sys

db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys = ON')
failures = []
for path in sorted(glob.glob('apps/edge/migrations/*.sql')):
    try:
        db.executescript(open(path).read())
    except Exception as e:
        failures.append(f"{os.path.basename(path)}: {e}")

if failures:
    for f in failures:
        print(f"  FAIL {f}")
    sys.exit(1)

# upload_sessions must have the v2 shape after the 0011 table rebuild.
cols = {r[1] for r in db.execute('PRAGMA table_info(upload_sessions)')}
required = {'organization_id', 'uploaded_bytes', 'declared_sha256',
            'cdn_domain', 'url_path', 'uploaded_at'}
missing = required - cols
if missing:
    print(f"  FAIL upload_sessions missing v2 columns: {sorted(missing)}")
    sys.exit(1)

# seed-d1-pilot.sql uses DELETE-then-INSERT: applying twice must be a no-op.
seed = open('scripts/seed-d1-pilot.sql').read()
db.executescript(seed)
db.executescript(seed)

counts = {
    'organizations': db.execute('SELECT COUNT(*) FROM organizations').fetchone()[0],
    'sites': db.execute('SELECT COUNT(*) FROM sites').fetchone()[0],
    'vendors': db.execute('SELECT COUNT(*) FROM vendors').fetchone()[0],
    'reviewers': db.execute('SELECT COUNT(*) FROM reviewers').fetchone()[0],
}
if (counts['organizations'], counts['sites'], counts['vendors'], counts['reviewers']) != (2, 2, 8, 3):
    print(f"  FAIL unexpected seed counts: {counts}")
    sys.exit(1)

print("  ✅ All D1 migrations applied; upload_sessions v2 rebuild verified; seed idempotent")
PY

echo "==> Verifying migration 0011 preserves interrupted upload parts"
python3 - <<'PY' || { echo "  ❌ D1 existing-upload migration failed" >&2; exit 1; }
import glob
import pathlib
import sqlite3
import sys

db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys = ON')
for path in sorted(glob.glob('apps/edge/migrations/*.sql')):
    if pathlib.Path(path).name == '0011_pilot_schema_completion.sql':
        break
    db.executescript(open(path).read())

def insert(table, values):
    columns = {row[1] for row in db.execute(f'PRAGMA table_info({table})')}
    keys = [key for key in values if key in columns]
    placeholders = ','.join('?' for _ in keys)
    db.execute(
        f"INSERT INTO {table}({','.join(keys)}) VALUES({placeholders})",
        [values[key] for key in keys],
    )

insert('organizations', {
    'id': 'org-upgrade', 'name': 'Upgrade Org', 'active': 1,
    'device_limit': 5, 'device_request_limit_per_minute': 10,
    'daily_receipt_limit': 50, 'storage_byte_limit': 1000000,
    'created_at': '2026-01-01', 'updated_at': '2026-01-01',
})
insert('sites', {
    'id': 'site-upgrade', 'organization_id': 'org-upgrade', 'name': 'Upgrade Site',
    'active': 1, 'allowed_wifi_ssids_json': '[]', 'configuration_version': 1,
    'daily_receipt_limit': 50, 'image_byte_limit': 750000,
    'storage_byte_limit': 1000000, 'stored_image_bytes': 0,
    'created_at': '2026-01-01', 'updated_at': '2026-01-01',
})
insert('devices', {
    'id': 'device-upgrade', 'site_id': 'site-upgrade', 'organization_id': 'org-upgrade',
    'name': 'Upgrade Device', 'token_hash': 'test-token', 'app_version': 'test',
    'active': 1, 'enrolled_at': '2026-01-01', 'last_seen_at': '2026-01-01',
})
insert('upload_sessions', {
    'id': 'upload-upgrade', 'receipt_id': 'receipt-upgrade', 'site_id': 'site-upgrade',
    'device_id': 'device-upgrade', 'metadata_json': '{}', 'total_bytes': 100,
    'image_sha256': 'a' * 64, 'mime_type': 'image/webp', 'status': 'OPEN',
    'expires_at': '2027-01-01', 'created_at': '2026-01-01', 'updated_at': '2026-01-01',
})
insert('upload_parts', {
    'upload_id': 'upload-upgrade', 'part_number': 1, 'byte_offset': 0,
    'byte_length': 100, 'sha256': 'b' * 64,
    'object_key': 'parts/upload-upgrade/1', 'created_at': '2026-01-01',
})
db.commit()

db.executescript(open('apps/edge/migrations/0011_pilot_schema_completion.sql').read())

session = db.execute(
    "SELECT status, url_path FROM upload_sessions WHERE id = 'upload-upgrade'"
).fetchone()
part = db.execute(
    "SELECT byte_offset, byte_length, object_key FROM upload_parts "
    "WHERE upload_id = 'upload-upgrade' AND part_number = 1"
).fetchone()
foreign_key_errors = db.execute('PRAGMA foreign_key_check').fetchall()
if session != ('IN_PROGRESS', '') or part != (0, 100, 'parts/upload-upgrade/1'):
    print(f"  FAIL migration lost resumable state: session={session!r} part={part!r}")
    sys.exit(1)
if foreign_key_errors:
    print(f"  FAIL migration introduced foreign-key errors: {foreign_key_errors!r}")
    sys.exit(1)

print("  ✅ Existing upload session and part survived migration 0011")
PY

echo "==> Checking local-pilot config render sets ENVIRONMENT=local-pilot"
# Regression gate: the local bridge endpoints (GET /v1/local/status,
# POST /v1/local/enrollment-codes), the receipt-enrichment queue drain, and the
# reviewer gateway-secret path are all gated on ENVIRONMENT === 'local-pilot'.
# The --local render must emit that value in [vars]; 'local' silently disables
# the entire supervised pilot (observed live as 404 NOT_FOUND on the bridge).
node scripts/render-edge-config.mjs --local >/dev/null
grep -qx 'ENVIRONMENT = "local-pilot"' apps/edge/config/edge.local.toml || {
  echo "  ❌ --local render must set ENVIRONMENT = \"local-pilot\"" >&2
  exit 1
}
echo "  ✅ Local render sets ENVIRONMENT = \"local-pilot\"."

echo "==> Checking compose mounts edge .dev.vars next to the local config"
# Wrangler looks for .dev.vars next to the config passed via --config
# (config/edge.local.toml), so the compose mount target must be the config dir.
grep -q '/edge.dev.vars:/app/apps/edge/config/.dev.vars:ro' deploy/local/docker-compose.yml || {
  echo "  ❌ compose edge service must mount .dev.vars into the config dir" >&2
  exit 1
}
echo "  ✅ Compose mounts edge .dev.vars next to the local config."

echo "==> Checking local-pilot.sh seeds DEVICE_TOKEN_PEPPER into edge.dev.vars"
# Regression gate: without DEVICE_TOKEN_PEPPER in edge.dev.vars the edge enrolls
# a device with an empty pepper but rejects every token at /v1/mobile/bootstrap
# (401 DEVICE_UNAUTHORIZED) — observed live during synthetic acceptance, where
# POST /v1/devices/enroll returned 201 but the subsequent bootstrap 401'd.
awk '/cat >"\$EDGE_VARS"/,/^EOF$/' scripts/local-pilot.sh | grep -Fqx "DEVICE_TOKEN_PEPPER=\$pepper" || {
  echo "  ❌ write_secret_files must seed DEVICE_TOKEN_PEPPER into edge.dev.vars" >&2
  exit 1
}
echo "  ✅ New provisions seed DEVICE_TOKEN_PEPPER into edge.dev.vars."

echo "==> Checking load_env heals a stale edge.dev.vars missing the pepper"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD/challanse-local"
printf 'DEVICE_TOKEN_PEPPER=regression-test-pepper\n' >"$TMPD/challanse-local/local.env"
printf 'ENVIRONMENT=local-pilot\n' >"$TMPD/challanse-local/edge.dev.vars"
XDG_CONFIG_HOME="$TMPD" bash -c '
  set -euo pipefail
  source scripts/local-pilot.sh
  ensure_edge_vars
  grep -q "^DEVICE_TOKEN_PEPPER=regression-test-pepper$" "$EDGE_VARS"
' || {
  echo "  ❌ ensure_edge_vars must copy DEVICE_TOKEN_PEPPER from local.env" >&2
  exit 1
}
echo "  ✅ Stale edge.dev.vars are healed with the local.env pepper."

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
