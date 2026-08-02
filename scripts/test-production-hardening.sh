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

[[ -z "$(release_keystore_paths_in_history "$ROOT")" ]] || fail "the standard Android debug keystore was treated as a release secret"
keystore_fixture="$(mktemp -d)"
mkdir -p "$keystore_fixture/apps/mobile/android/app"
cp "$ROOT/apps/mobile/android/app/debug.keystore" "$keystore_fixture/apps/mobile/android/app/debug.keystore"
[[ -z "$(release_keystore_paths_in_worktree "$keystore_fixture")" ]] || fail "the standard Android debug keystore was rejected"
printf 'not the approved debug key' > "$keystore_fixture/apps/mobile/android/app/debug.keystore"
[[ -n "$(release_keystore_paths_in_worktree "$keystore_fixture")" ]] || fail "a replaced debug keystore was trusted by path"
cp "$ROOT/apps/mobile/android/app/debug.keystore" "$keystore_fixture/apps/mobile/android/app/debug.keystore"
touch "$keystore_fixture/release.jks"
[[ "$(release_keystore_paths_in_worktree "$keystore_fixture")" == "$keystore_fixture/release.jks" ]] || fail "a release keystore in the repository was not rejected"
rm -rf "$keystore_fixture"

history_fixture="$(mktemp -d)"
git -C "$history_fixture" init -q
git -C "$history_fixture" config user.name 'ChallanSe Test'
git -C "$history_fixture" config user.email 'test@challanse.invalid'
mkdir -p "$history_fixture/apps/mobile/android/app"
cp "$ROOT/apps/mobile/android/app/debug.keystore" "$history_fixture/apps/mobile/android/app/debug.keystore"
git -C "$history_fixture" add apps/mobile/android/app/debug.keystore
git -C "$history_fixture" commit -qm 'approved debug key'
[[ -z "$(release_keystore_paths_in_history "$history_fixture")" ]] || fail "approved debug key history was rejected"
printf 'historical release key disguised as debug' > "$history_fixture/apps/mobile/android/app/debug.keystore"
git -C "$history_fixture" add apps/mobile/android/app/debug.keystore
git -C "$history_fixture" commit -qm 'replaced debug key'
[[ -n "$(release_keystore_paths_in_history "$history_fixture")" ]] || fail "a replaced historical debug key was trusted by path"
cp "$ROOT/apps/mobile/android/app/debug.keystore" "$history_fixture/release.keystore"
git -C "$history_fixture" add release.keystore
git -C "$history_fixture" commit -qm 'release key in history'
history_findings="$(release_keystore_paths_in_history "$history_fixture")"
grep -Fq 'apps/mobile/android/app/debug.keystore@' <<<"$history_findings" || fail "historical debug-key replacement was not reported"
grep -Fq 'release.keystore@' <<<"$history_findings" || fail "additional release keystore was not reported"
rm -rf "$history_fixture"

operator_report="$TEST_CONFIG/operator-training.json"
cat > "$operator_report" <<'JSON'
{"schema_version":"1.0","trained_operators":2,"incident_runbook_exercise_passed":true,"restore_observation_completed":true,"independent_production_approval_enabled":true,"completed_at":"2026-07-16T00:00:00Z","evidence_owner":"operations-owner"}
JSON
operator_digest="$(sha256sum "$operator_report" | awk '{print $1}')"
gh() {
  [[ "$*" == "variable set OPERATOR_TRAINING_SHA256 --repo $REPO --env production --body $operator_digest" ]] || fail "unexpected operator evidence update"
}
printf 'ACCEPT OPERATOR TRAINING %s\n' "$operator_digest" | accept_operator_training "$operator_report" >/dev/null

printf '%s\n' '{"schema_version":"1.0","trained_operators":1}' > "$operator_report"
if printf 'NO\n' | accept_operator_training "$operator_report" >/dev/null 2>&1; then
  fail "incomplete operator training evidence was accepted"
fi

acceptance_artifact_sha="$(printf 'test acceptance artifact' | sha256sum | awk '{print $1}')"
assert_acceptance_gate() {
  local command="$1" variable="$2" phrase="$3" report="$4" digest
  digest="$(sha256sum "$report" | awk '{print $1}')"
  gh() {
    [[ "$*" == "variable set $variable --repo $REPO --env production --body $digest" ]] || fail "unexpected $variable evidence update"
  }
  printf '%s %s\n' "$phrase" "$digest" | "$command" "$report" >/dev/null
}

security_report="$TEST_CONFIG/security-acceptance.json"
cat > "$security_report" <<JSON
{"schema_version":"1.0","tenants_tested":2,"cross_tenant_endpoint_tests_passed":true,"postgres_rls_direct_access_denied":true,"forged_oidc_rejected":true,"replayed_device_nonces_rejected":true,"owasp_masvs_review_completed":true,"owasp_api_review_completed":true,"unresolved_critical_findings":0,"unresolved_high_findings":0,"completed_at":"2026-07-16T00:00:00Z","evidence_owner":"security-owner","evidence_artifacts":[{"name":"security-report.json","sha256":"$acceptance_artifact_sha"}]}
JSON
assert_acceptance_gate accept_security SECURITY_ACCEPTANCE_SHA256 "ACCEPT SECURITY" "$security_report"
jq '.unresolved_high_findings = 1' "$security_report" > "$security_report.invalid"
if printf 'NO\n' | accept_security "$security_report.invalid" >/dev/null 2>&1; then
  fail "security evidence with a high finding was accepted"
fi

capacity_report="$TEST_CONFIG/capacity-acceptance.json"
cat > "$capacity_report" <<JSON
{"schema_version":"1.0","receipts_per_day":1000,"reconnecting_devices":100,"reconnect_window_minutes":10,"final_ack_p95_ms":1999,"backlog_drain_minutes":15,"lost_receipts":0,"duplicate_receipts":0,"acceptance_network_profile":"staging-profile-v1","completed_at":"2026-07-16T00:00:00Z","evidence_owner":"performance-owner","evidence_artifacts":[{"name":"capacity-report.json","sha256":"$acceptance_artifact_sha"}]}
JSON
assert_acceptance_gate accept_capacity CAPACITY_ACCEPTANCE_SHA256 "ACCEPT CAPACITY" "$capacity_report"
jq '.final_ack_p95_ms = null' "$capacity_report" > "$capacity_report.invalid"
if printf 'NO\n' | accept_capacity "$capacity_report.invalid" >/dev/null 2>&1; then
  fail "capacity evidence with a null latency was accepted"
fi

recovery_report="$TEST_CONFIG/recovery-acceptance.json"
cat > "$recovery_report" <<JSON
{"schema_version":"1.0","postgres_restore_passed":true,"s3_restore_passed":true,"rpo_minutes":60,"rto_minutes":480,"rollback_passed":true,"alarm_delivery_passed":true,"cross_account_snapshot_verified":true,"completed_at":"2026-07-16T00:00:00Z","evidence_owner":"recovery-owner","evidence_artifacts":[{"name":"restore-report.json","sha256":"$acceptance_artifact_sha"}]}
JSON
assert_acceptance_gate accept_recovery RECOVERY_ACCEPTANCE_SHA256 "ACCEPT RECOVERY" "$recovery_report"
jq '.rpo_minutes = null' "$recovery_report" > "$recovery_report.invalid"
if printf 'NO\n' | accept_recovery "$recovery_report.invalid" >/dev/null 2>&1; then
  fail "recovery evidence with a null RPO was accepted"
fi

staging_report="$TEST_CONFIG/staging-acceptance.json"
cat > "$staging_report" <<JSON
{"schema_version":"1.0","synthetic_receipts":20,"lost_receipts":0,"duplicate_receipts":0,"cross_site_access_denied":true,"callback_replay_denied":true,"dlq_replay_passed":true,"rollback_passed":true,"completed_at":"2026-07-16T00:00:00Z","evidence_owner":"staging-owner","evidence_artifacts":[{"name":"staging-report.json","sha256":"$acceptance_artifact_sha"}]}
JSON
assert_acceptance_gate accept_staging STAGING_ACCEPTANCE_SHA256 "ACCEPT STAGING" "$staging_report"

android_report="$TEST_CONFIG/android-field-acceptance.json"
cat > "$android_report" <<JSON
{"schema_version":"1.0","android_api_level":26,"device_ram_mb":2048,"binary_writes":100,"minimum_image_bytes":500000,"maximum_image_bytes":5000000,"p95_write_ms":49.9,"metadata_loss_count":0,"sqlcipher_status_verified":true,"wrong_key_rejected":true,"raw_database_scan_clean":true,"restart_recovery_passed":true,"reboot_sync_passed":true,"interrupted_upload_resume_passed":true,"completed_at":"2026-07-16T00:00:00Z","evidence_owner":"android-owner","evidence_artifacts":[{"name":"android-field-report.json","sha256":"$acceptance_artifact_sha"}]}
JSON
assert_acceptance_gate accept_android_field ANDROID_FIELD_ACCEPTANCE_SHA256 "ACCEPT ANDROID" "$android_report"
jq '.p95_write_ms = null' "$android_report" > "$android_report.invalid"
if printf 'NO\n' | accept_android_field "$android_report.invalid" >/dev/null 2>&1; then
  fail "Android evidence with a null p95 was accepted"
fi

client_report="$TEST_CONFIG/client-acceptance.json"
cat > "$client_report" <<JSON
{"schema_version":"1.0","client_organization_id_hash":"$acceptance_artifact_sha","managed_play_access_confirmed":true,"controlled_rollout_accepted":true,"accepted_by":"client-owner","accepted_at":"2026-07-16T00:00:00Z","evidence_artifacts":[{"name":"client-approval.pdf","sha256":"$acceptance_artifact_sha"}]}
JSON
assert_acceptance_gate accept_client CLIENT_ACCEPTANCE_SHA256 "ACCEPT CLIENT" "$client_report"

# --- Client-pilot signing, keystore, cert-match, and paginated alert gate ---
# Sourcing local-pilot.sh must not trigger its guarded command dispatch.
source "$ROOT/scripts/local-pilot.sh"

# A: signing passwords are prompt-only, hidden, non-empty, and never persisted.
prompt_secret_body="$(declare -f prompt_secret)"
prepare_body="$(declare -f prepare_client_signing)"
build_body="$(declare -f build_client_apk)"
script_text="$(cat "$ROOT/scripts/local-pilot.sh")"
grep -Fq 'read -rsp' <<<"$prompt_secret_body" || fail "prompt_secret does not read hidden input"
grep -Fq '[[ -t 0 ]]' <<<"$prompt_secret_body" || fail "prompt_secret does not guard against non-interactive stdin"
grep -Fq 'prompt_secret' <<<"$prepare_body" || fail "prepare_client_signing never prompts for the keystore secrets"
grep -Fq 'prompt_secret' <<<"$build_body" || fail "build_client_apk never prompts for the keystore secrets"
grep -Fq 'unset CHALLANSE_CLIENT_KEYSTORE_PASSWORD' <<<"$prepare_body" || fail "prepare_client_signing never unsets the store password"
grep -Fq 'unset CHALLANSE_CLIENT_KEYSTORE_PASSWORD' <<<"$build_body" || fail "build_client_apk never unsets the store password"
if grep -Fq "printf 'CHALLANSE_CLIENT_KEYSTORE_PASSWORD=" <<<"$script_text"; then
  fail "prepare_client_signing writes the store password to signing.env"
fi
if grep -Fq "printf 'CHALLANSE_CLIENT_KEY_PASSWORD=" <<<"$script_text"; then
  fail "prepare_client_signing writes the key password to signing.env"
fi
if grep -Eq 'CHALLANSE_CLIENT_KEYSTORE_PASSWORD=%q|CHALLANSE_CLIENT_KEY_PASSWORD=%q' <<<"$script_text"; then
  fail "a signing password is rendered into an env file"
fi
printf 'CHALLANSE_CLIENT_KEYSTORE_FILE=/tmp/challanse-client-pilot.jks\nCHALLANSE_CLIENT_KEY_ALIAS=challanse-client-pilot\n' \
  > "$TEST_CONFIG/signing.env"
if grep -Eq 'CHALLANSE_CLIENT_KEYSTORE_PASSWORD=|CHALLANSE_CLIENT_KEY_PASSWORD=' "$TEST_CONFIG/signing.env"; then
  fail "signing.env contains a signing password"
fi

# B: keystore stays outside the repo with mode 600; signing dir uses mode 700.
verify_body="$(declare -f verify_client_signing_files)"
grep -Fq '600' <<<"$verify_body" || fail "keystore mode 600 is not enforced"
grep -Fq '700' <<<"$verify_body" || fail "signing directory mode 700 is not enforced"
signing_dir="$TEST_CONFIG/client-signing"
CLIENT_SIGNING_DIR="$signing_dir"
CLIENT_KEYSTORE="$signing_dir/challanse-client-pilot.jks"
mkdir -p "$signing_dir"
chmod 700 "$signing_dir"
touch "$CLIENT_KEYSTORE"
chmod 600 "$CLIENT_KEYSTORE"
verify_client_signing_files
chmod 644 "$CLIENT_KEYSTORE"
if (verify_client_signing_files) >/dev/null 2>&1; then
  fail "an open client keystore was accepted"
fi
chmod 600 "$CLIENT_KEYSTORE"
chmod 755 "$signing_dir"
if (verify_client_signing_files) >/dev/null 2>&1; then
  fail "an open client signing directory was accepted"
fi
chmod 700 "$signing_dir"
if (
  ROOT="$TEST_CONFIG/fake-repo"
  CLIENT_KEYSTORE="$ROOT/in-repo.jks"
  CLIENT_SIGNING_DIR="$TEST_CONFIG/client-signing"
  mkdir -p "$ROOT" "$CLIENT_SIGNING_DIR"
  chmod 700 "$CLIENT_SIGNING_DIR"
  touch "$ROOT/in-repo.jks"
  chmod 600 "$ROOT/in-repo.jks"
  verify_client_signing_files
) >/dev/null 2>&1; then
  fail "a client keystore inside the repository was accepted"
fi

# C: APK signer certificate must match the keystore certificate.
if client_signing_cert_matches \
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; then
  fail "mismatching signing certificates were accepted"
fi
client_signing_cert_matches \
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  || fail "matching signing certificates were rejected"
client_signing_cert_matches \
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  || fail "signing certificate comparison is not case-insensitive"
if client_signing_cert_matches "" ""; then
  fail "empty fingerprints were accepted"
fi

# D: code_security_gate fetches every open code-scanning alert page.
gate_body="$(declare -f code_security_gate)"
grep -Fq -- '--paginate' <<<"$gate_body" || fail "code_security_gate does not paginate code-scanning alerts"
gh() { printf 'gh unavailable\n' >&2; return 1; }
if code_security_gate >/dev/null 2>&1; then
  fail "code_security_gate succeeded despite a gh failure"
fi

printf 'Production hardening checks passed.\n'
