#!/bin/bash
# ============================================================================
# validate-migrations.sh — PostgreSQL Migration Validation Script
# ============================================================================
# Purpose:
#   Validates all enrichment service PostgreSQL migration files (0001–0012)
#   by applying them to a temporary database sequentially. Unlike the current
#   CI step which only checks file existence via `test -s`, this script
#   actually runs each SQL migration against a real PostgreSQL instance and
#   reports pass/fail per migration.
#
# Usage:
#   ./scripts/validate-migrations.sh [--check-only] [--migrations-dir DIR] [DATABASE_URL]
#
# Modes:
#   --check-only      Only validate file presence without connecting to a DB.
#                     Exits with non-zero if any migration file is missing.
#   --migrations-dir   Path to the directory containing migration *.sql files.
#                     Default: <project_root>/services/enrichment/migrations
#
# DATABASE_URL:
#   PostgreSQL connection string for a superuser/admin account (needed for
#   CREATE DATABASE, DROP DATABASE, and CREATE EXTENSION operations within
#   the migrations). Default:
#     postgresql://postgres:postgres@localhost:5432/postgres
#
#   In GitHub Actions (integration job), the PostgreSQL service container
#   creates the configured user as a superuser, so the CI connection string
#   like `postgresql://challanse:challanse-test-only@127.0.0.1:5432/challanse_test`
#   is sufficient.
#
# Behavior:
#   1. Parses arguments (--check-only / --migrations-dir / DATABASE_URL)
#   2. Lists expected migration files and checks they exist (sorted, 0001–0012)
#   3. In --check-only mode: exits after file validation
#   4. In default mode:
#      a. Creates a temporary database (challanse_migration_validate_<PID>)
#      b. Applies each migration SQL file in order using psql
#      c. Prints pass/fail for each migration
#      d. Drops the temporary database on exit (even on failure)
#      e. Exits with 0 if all applied, 1 if any failed
#
# Exit codes:
#   0  — All migrations validated successfully (or check-only passed)
#   1  — One or more migrations failed validation
#   2  — Usage error or pre-flight check failed
#
# Requirements:
#   - psql (PostgreSQL client) installed and in PATH
#   - DATABASE_URL must point to a role with CREATEDB privilege
#   - For full validation: a running PostgreSQL instance
#
# CI Integration:
#   This script is designed to run in GitHub Actions as part of the
#   'validate' or 'enrichment' job. Example integration step:
#
#       - name: Validate PostgreSQL migrations end-to-end
#         run: bash scripts/validate-migrations.sh
#         env:
#           DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres
#
#   For the existing integration job (which has a PostgreSQL service):
#
#       - name: Validate enrichment migrations
#         run: bash scripts/validate-migrations.sh "$TEST_DATABASE_URL"
#
# ============================================================================

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_MIGRATIONS_DIR="$PROJECT_DIR/services/enrichment/migrations"

MIGRATIONS_DIR="$DEFAULT_MIGRATIONS_DIR"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
CHECK_ONLY=false
TEMP_DB=""
CLEANUP_DONE=false

# Expected migration files in order
EXPECTED_MIGRATIONS=(
  "0001_enrichment.sql"
  "0002_release_hardening.sql"
  "0003_operational_jobs.sql"
  "0004_replay_protection.sql"
  "0005_production_tenancy.sql"
  "0006_local_pilot.sql"
  "0007_local_pilot_controls.sql"
  "0008_local_service_health.sql"
  "0009_local_test_runs.sql"
  "0010_local_test_run_identity_retention.sql"
  "0011_manual_invoice_entry.sql"
  "0012_reviewer_image_invoice.sql"
)
EXPECTED_COUNT="${#EXPECTED_MIGRATIONS[@]}"

# ─── Helper Functions ───────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [DATABASE_URL]

Validate PostgreSQL migration files by applying them to a temporary database.

OPTIONS:
  --check-only         Check migration file presence without running them
  --migrations-dir DIR Path to migration SQL files (default: services/enrichment/migrations)

ARGUMENTS:
  DATABASE_URL         PostgreSQL connection string (default: postgresql://postgres:postgres@localhost:5432/postgres)
                       Can also be set via the DATABASE_URL environment variable.

EXAMPLES:
  $(basename "$0") --check-only
  $(basename "$0") "postgresql://user:pass@host:5432/db"
  $(basename "$0") --migrations-dir ./custom-migrations

CI EXAMPLE (with PostgreSQL service container):
  $(basename "$0") "\$TEST_DATABASE_URL"
EOF
  exit 2
}

log_info()  { printf "  [INFO]  %s\n" "$*"; }
log_ok()    { printf "  [  OK  ] %s\n" "$*"; }
log_fail()  { printf "  [ FAIL ] %s\n" "$*"; }
log_error() { printf "  [ERROR] %s\n" "$*" >&2; }

# ─── Cleanup Handler ────────────────────────────────────────────────────────

cleanup() {
  if [ "$CLEANUP_DONE" = true ]; then
    return
  fi
  CLEANUP_DONE=true

  if [ -n "$TEMP_DB" ] && [ "$CHECK_ONLY" = false ]; then
    local admin_url="${DATABASE_URL%/*}/postgres"
    log_info "Dropping temporary database: $TEMP_DB"
    # Drop with force-terminate to handle any lingering connections
    psql "$admin_url" \
      -c "REVOKE CONNECT ON DATABASE \"$TEMP_DB\" FROM PUBLIC;" 2>/dev/null || true
    psql "$admin_url" \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TEMP_DB';" \
      2>/dev/null || true
    psql "$admin_url" \
      -c "DROP DATABASE IF EXISTS \"$TEMP_DB\";" \
      2>/dev/null || true
  fi
}

# ─── Parse Arguments ────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)
      CHECK_ONLY=true
      shift
      ;;
    --migrations-dir)
      if [[ -z "${2:-}" ]]; then
        log_error "--migrations-dir requires a value"
        usage
      fi
      MIGRATIONS_DIR="$2"
      shift 2
      ;;
    --migrations-dir=*)
      MIGRATIONS_DIR="${1#*=}"
      shift
      ;;
    --help|-h)
      usage
      ;;
    -*)
      log_error "Unknown option: $1"
      usage
      ;;
    *)
      # Positional argument: DATABASE_URL
      DATABASE_URL="$1"
      shift
      ;;
  esac
done

# ─── Pre-flight Checks ──────────────────────────────────────────────────────

if [ ! -d "$MIGRATIONS_DIR" ]; then
  log_error "Migrations directory not found: $MIGRATIONS_DIR"
  log_error "Use --migrations-dir to specify the correct path."
  exit 2
fi

# ─── Phase 1: File Presence Validation ──────────────────────────────────────
# This phase always runs, regardless of mode.

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Migration Validation Script"
echo "  Mode: $([ "$CHECK_ONLY" = true ] && echo 'CHECK-ONLY (file presence)' || echo 'FULL (database apply)')"
echo "  Migrations directory: $MIGRATIONS_DIR"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

echo "── Phase 1: File Presence Validation ──"
echo ""

missing_count=0
present_count=0

for migration in "${EXPECTED_MIGRATIONS[@]}"; do
  file_path="$MIGRATIONS_DIR/$migration"
  if [ -f "$file_path" ] && [ -s "$file_path" ]; then
    log_ok "$migration ($(wc -c < "$file_path") bytes)"
    present_count=$((present_count + 1))
  elif [ -f "$file_path" ]; then
    log_fail "$migration (exists but EMPTY)"
    missing_count=$((missing_count + 1))
  else
    log_fail "$migration (MISSING)"
    missing_count=$((missing_count + 1))
  fi
done

echo ""
echo "  Results:  $present_count present, $missing_count missing/empty (expected $EXPECTED_COUNT)"
echo ""

if [ "$missing_count" -gt 0 ]; then
  log_error "Phase 1 FAILED — $missing_count migration file(s) missing or empty."
  exit 1
fi

log_info "Phase 1 PASSED — all $EXPECTED_COUNT migration files present."

# ─── Phase 2: SQL Application Validation ────────────────────────────────────
# This phase only runs in non-check-only mode.

if [ "$CHECK_ONLY" = true ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════"
  echo "  CHECK-ONLY mode — all files validated. No database connection made."
  echo "═══════════════════════════════════════════════════════════════════════"
  echo ""
  exit 0
fi

echo ""
echo "── Phase 2: SQL Application Validation ──"
echo ""

# Verify psql is available
if ! command -v psql &>/dev/null; then
  log_error "psql (PostgreSQL client) not found in PATH."
  log_error "Install the PostgreSQL client package, e.g.:"
  log_error "  Ubuntu/Debian: sudo apt-get install postgresql-client"
  log_error "  macOS:         brew install libpq"
  log_error "  CI (default):  already present in ubuntu-latest"
  exit 2
fi

# Verify we can connect to the database
log_info "Testing database connectivity..."
if ! psql "$DATABASE_URL" -c "SELECT 1 AS connectivity_test;" &>/dev/null; then
  # Mask credentials in connection string for safe display
  if [[ "$DATABASE_URL" == *@* ]]; then
    masked_url="${DATABASE_URL#*@}"
    masked_url="postgresql://****:****@${masked_url}"
  else
    masked_url="$DATABASE_URL"
  fi
  log_error "Cannot connect to PostgreSQL at: $masked_url"
  log_error "Ensure PostgreSQL is running and the connection string is correct."
  log_error "Use --check-only to validate files without a database connection."
  exit 2
fi
log_ok "Database connectivity confirmed."

# Generate a unique temporary database name
TEMP_DB="challanse_migration_validate_$$_$(date +%s)"

# Derive the admin base URL (connecting to 'postgres' or 'template1' database)
# for CREATE/DROP DATABASE operations
ADMIN_URL="${DATABASE_URL%/*}/postgres"

# Set up trap for cleanup
trap cleanup EXIT
trap 'cleanup; exit 1' INT TERM

# Create the temporary database
echo ""
log_info "Creating temporary database: $TEMP_DB"
psql "$ADMIN_URL" \
  -c "CREATE DATABASE \"$TEMP_DB\" WITH ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';" \
  || {
    log_error "Failed to create temporary database."
    log_error "Ensure the DATABASE_URL role has CREATEDB privilege."
    exit 1
  }
log_ok "Temporary database created."

# Construct the connection string for the temp database
TEMP_DB_URL="${DATABASE_URL%/*}/$TEMP_DB"

# Apply each migration in sequence
echo ""
passed=0
failed=0
failed_migrations=""

for migration in "${EXPECTED_MIGRATIONS[@]}"; do
  file_path="$MIGRATIONS_DIR/$migration"
  printf "  Applying %s ... " "$migration"

  # Use ON_ERROR_STOP=1 so psql fails fast on any SQL error
  if psql -v ON_ERROR_STOP=1 -q -X "$TEMP_DB_URL" -f "$file_path" &>/tmp/challanse_migration_$$.log; then
    echo "✓ PASSED"
    passed=$((passed + 1))
  else
    echo "✗ FAILED"
    failed=$((failed + 1))
    failed_migrations="$failed_migrations  - $migration"
    # Collect error details
    if [ -f /tmp/challanse_migration_$$.log ]; then
      log_error "Error details for $migration:"
      sed 's/^/      /' /tmp/challanse_migration_$$.log
    fi
    # Show the last line of the migration file (common error location)
    log_error "Last line of $migration: $(tail -1 "$file_path")"
    # Fail fast — exit immediately
    exit 1
  fi
done

# Clean up temp log
rm -f /tmp/challanse_migration_$$.log

# ─── Results ────────────────────────────────────────────────────────────────

echo ""
echo "── Migration Application Results ──"
echo ""
echo "  Total:  $EXPECTED_COUNT"
echo "  Passed: $passed"
echo "  Failed: $failed"
echo ""

if [ "$failed" -gt 0 ]; then
  log_error "The following migrations FAILED to apply:"
  echo "$failed_migrations"
  echo ""
  log_error "Migration validation FAILED."
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Migration validation PASSED — all $EXPECTED_COUNT migrations"
echo "  applied successfully to temporary database."
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
