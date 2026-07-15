#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2317
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_CONFIG="$(mktemp -d)"
trap 'rm -rf "$TEST_CONFIG"' EXIT
export XDG_CONFIG_HOME="$TEST_CONFIG"
source "$ROOT/scripts/go-live.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

github_environment_secret_exists() { [[ "$1" == DEVICE_TOKEN_PEPPER ]]; }
[[ -z "$(resolve_device_token_pepper)" ]] || fail "existing device pepper was replaced"

github_environment_secret_exists() { return 1; }
new_pepper="$(resolve_device_token_pepper)"
[[ "$new_pepper" =~ ^[0-9a-f]{64}$ ]] || fail "new device pepper was not generated securely"

safe_dir="$(mktemp -d)"
validate_new_keystore_path "$safe_dir/release-key.jks"
if (validate_new_keystore_path "$ROOT/release-key.jks") >/dev/null 2>&1; then
  fail "repository keystore path was accepted"
fi
touch "$safe_dir/existing.jks"
if (validate_new_keystore_path "$safe_dir/existing.jks") >/dev/null 2>&1; then
  fail "existing keystore overwrite was accepted"
fi
if (validate_new_keystore_path "$safe_dir/password!value.jks") >/dev/null 2>&1; then
  fail "unsafe keystore filename was accepted"
fi
rm -rf "$safe_dir"

printf 'Production hardening checks passed.\n'
