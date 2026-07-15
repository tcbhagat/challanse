#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2034,SC2317
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/go-live.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

cf_calls=0
gh_checks=0
github_turnstile_secret_exists() { gh_checks=$((gh_checks + 1)); return 1; }
cf() {
  cf_calls=$((cf_calls + 1))
  [[ "$1" == "POST" ]] || fail "rotation did not use POST"
  [[ "$2" == "/accounts/test-account/challenges/widgets/test-sitekey/rotate_secret" ]] || fail "rotation endpoint changed"
  [[ "$3" == '{"invalidate_immediately":true}' ]] || fail "rotation must immediately invalidate the unused secret"
  printf '{"success":true,"result":{"secret":"replacement-secret"}}'
}
CLOUDFLARE_ACCOUNT_ID=test-account

returned="$(resolve_turnstile_secret test-sitekey new-widget-secret)"
[[ "$returned" == "new-widget-secret" ]] || fail "new widget secret was not preserved"
[[ "$gh_checks" == "0" && "$cf_calls" == "0" ]] || fail "new widget path performed recovery work"

github_turnstile_secret_exists() { return 0; }
returned="$(resolve_turnstile_secret test-sitekey '')"
[[ -z "$returned" ]] || fail "existing GitHub secret should not be returned or replaced"
[[ "$cf_calls" == "0" ]] || fail "existing GitHub secret was rotated"

github_turnstile_secret_exists() { return 1; }
returned="$(printf 'YES\n' | resolve_turnstile_secret test-sitekey '')"
[[ "$returned" == "replacement-secret" ]] || fail "rotation response secret was not captured"

rotation_log="$(mktemp)"
trap 'rm -f "$rotation_log"' EXIT
cf() { printf 'called\n' >> "$rotation_log"; return 1; }
if printf 'NO\n' | resolve_turnstile_secret test-sitekey '' >/dev/null 2>&1; then
  fail "declined recovery unexpectedly succeeded"
fi
[[ ! -s "$rotation_log" ]] || fail "declined recovery called Cloudflare"

cf() { return 1; }
if printf 'YES\n' | resolve_turnstile_secret test-sitekey '' >/dev/null 2>&1; then
  fail "Cloudflare rotation failure unexpectedly succeeded"
fi

printf 'Turnstile recovery checks passed.\n'
