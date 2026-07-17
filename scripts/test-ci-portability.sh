#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAKE_BIN="$(mktemp -d)"
OUTPUT="$(mktemp)"
trap 'rm -rf "$FAKE_BIN" "$OUTPUT"' EXIT

ln -s "$(command -v bash)" "$FAKE_BIN/bash"
ln -s "$(command -v dirname)" "$FAKE_BIN/dirname"

if PATH="$FAKE_BIN" /bin/bash "$ROOT/scripts/test-production-config.sh" >"$OUTPUT" 2>&1; then
  echo "Production checks passed despite a missing required search command." >&2
  exit 1
fi

grep -Fq 'Required CI command is unavailable: grep' "$OUTPUT" || {
  echo "Production checks did not fail closed with a clear missing-command error." >&2
  exit 1
}

echo "CI portability checks passed."
