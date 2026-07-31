#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "Production configuration check failed: $*" >&2
  exit 1
}

# Runs a single check with a human-readable description. On failure, prints
# "FAIL: <description>" plus the exact command that failed, then exits 1.
assert() {
  local description="$1"
  shift
  if ! "$@"; then
    echo "FAIL: $description" >&2
    echo "  command: $*" >&2
    exit 1
  fi
}

for required_command in bash grep jq shellcheck; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "Required CI command is unavailable: $required_command" >&2
    exit 1
  }
done

contains_forbidden() {
  local status
  if grep "$@"; then
    return 0
  else
    status=$?
  fi
  [[ "$status" -eq 1 ]] && return 1
  echo "Security search failed instead of completing: grep $*" >&2
  exit "$status"
}
assert "scripts/go-live.sh must pass bash syntax validation" bash -n scripts/go-live.sh
assert "scripts/rollback-production.sh must pass bash syntax validation" bash -n scripts/rollback-production.sh
assert "scripts/test-turnstile-recovery.sh must pass bash syntax validation" bash -n scripts/test-turnstile-recovery.sh
assert "scripts/test-production-hardening.sh must pass bash syntax validation" bash -n scripts/test-production-hardening.sh
assert "scripts/test-budget-controls.sh must pass bash syntax validation" bash -n scripts/test-budget-controls.sh
assert "scripts/zero-cost-readiness.sh must pass bash syntax validation" bash -n scripts/zero-cost-readiness.sh
assert "scripts/test-zero-cost-readiness.sh must pass bash syntax validation" bash -n scripts/test-zero-cost-readiness.sh
assert "scripts/local-pilot.sh must pass bash syntax validation" bash -n scripts/local-pilot.sh
assert "scripts/challanse-local-launcher.sh must pass bash syntax validation" bash -n scripts/challanse-local-launcher.sh
assert "scripts/install-local-launcher.sh must pass bash syntax validation" bash -n scripts/install-local-launcher.sh
assert "scripts/test-local-ui.sh must pass bash syntax validation" bash -n scripts/test-local-ui.sh
assert "scripts/quality-loop.sh must pass bash syntax validation" bash -n scripts/quality-loop.sh
assert "scripts/test-local-pilot-storage.sh must pass bash syntax validation" bash -n scripts/test-local-pilot-storage.sh
assert "scripts/test-waf-provisioning.sh must pass shellcheck" shellcheck -e SC1090 scripts/test-waf-provisioning.sh
assert "all production shell scripts must pass shellcheck" \
  shellcheck -e SC1090 \
  scripts/go-live.sh scripts/rollback-production.sh scripts/local-pilot.sh \
  scripts/challanse-local-launcher.sh scripts/install-local-launcher.sh \
  scripts/test-local-ui.sh scripts/quality-loop.sh scripts/test-local-pilot-storage.sh \
  scripts/test-production-config.sh scripts/test-turnstile-recovery.sh \
  scripts/test-production-hardening.sh scripts/test-budget-controls.sh \
  scripts/zero-cost-readiness.sh scripts/test-zero-cost-readiness.sh
assert "local-pilot storage safety checks must pass" bash scripts/test-local-pilot-storage.sh
assert "scripts/go-live.sh must be executable" test -x scripts/go-live.sh
assert "scripts/rollback-production.sh must be executable" test -x scripts/rollback-production.sh
assert "ci-pages.yml must use the /api Vite base URL" \
  grep -Fq "VITE_API_BASE_URL: /api" .github/workflows/ci-pages.yml
assert "reviewer worker must point at the production API origin" \
  grep -Fq 'API_ORIGIN = "https://api.challanse.constrovet.com"' apps/reviewer/wrangler.toml
assert "reviewer worker must enforce Cloudflare Access JWT assertions" \
  grep -Fq "Cf-Access-Jwt-Assertion" apps/reviewer/src/worker.ts
assert "go-live.sh must support the dns-onboard phase" grep -Fq 'dns-onboard' scripts/go-live.sh
assert "go-live.sh must support the dns-status phase" grep -Fq 'dns-status' scripts/go-live.sh
assert "go-live.sh must support the dns-accept phase" grep -Fq 'dns-accept' scripts/go-live.sh
assert "go-live.sh must pin the Cloudflare tunnel to the fixed edge IP" grep -Fq '34.102.192.38' scripts/go-live.sh
assert "go-live.sh must publish the landing site to tcbhagat.github.io" grep -Fq 'tcbhagat.github.io' scripts/go-live.sh
assert "go-live.sh must configure the alt4.aspmx.l.google.com mail route" grep -Fq 'alt4.aspmx.l.google.com' scripts/go-live.sh
assert "go-live.sh must track the DNS acceptance timestamp" grep -Fq 'DNS_ACCEPTED_AT' scripts/go-live.sh
assert "go-live.sh must surface Cloudflare error details" grep -Fq 'Cloudflare error details:' scripts/go-live.sh
assert "go-live.sh must grant Cloudflare Account Zone Edit access" grep -Fq 'Account > Zone > Edit' scripts/go-live.sh
assert "go-live.sh must grant Zone Dynamic URL Redirects Edit access" grep -Fq 'Zone > Dynamic URL Redirects > Edit' scripts/go-live.sh
assert "go-live.sh must verify the app redirect endpoint" grep -Fq 'https://www.constrovet.com/app/' scripts/go-live.sh
assert "go-live.sh must print an APP REDIRECT OK confirmation" grep -Fq 'APP REDIRECT OK' scripts/go-live.sh
assert "go-live.sh must support immediate CDN invalidation" grep -Fq 'invalidate_immediately' scripts/go-live.sh
assert "go-live.sh must rotate the device pepper" grep -Fq 'ROTATE DEVICE PEPPER' scripts/go-live.sh
assert "go-live.sh must store the upload certificate SHA-256" grep -Fq 'CHALLANSE_UPLOAD_CERT_SHA256' scripts/go-live.sh
assert "go-live.sh must store the Play app-signing certificate SHA-256" grep -Fq 'CHALLANSE_PLAY_APP_SIGNING_CERT_SHA256' scripts/go-live.sh
assert "go-live.sh must store the Play service account JSON secret" grep -Fq 'PLAY_SERVICE_ACCOUNT_JSON' scripts/go-live.sh
assert "mobile must ship an AAB via bundleRelease" grep -Fq 'bundleRelease' apps/mobile/package.json
if contains_forbidden -RInE --exclude='test-production-config.sh' --exclude='local-pilot.sh' 'assembleRelease|download-apk|app-release\.apk' .github scripts apps/mobile/package.json README.md docs/release-readiness.md; then
  fail "Production distribution must remain AAB-only through Managed Google Play."
fi
assert "android app must use the .localpilot applicationId suffix" \
  grep -Fq 'applicationIdSuffix ".localpilot"' apps/mobile/android/app/build.gradle
assert "mobile pilot app must contain the SYNTHETIC TEST marker" grep -Fq 'SYNTHETIC TEST' apps/mobile/src/PilotApp.tsx
assert "mobile pilot app must contain the CONTROLLED CLIENT PILOT marker" grep -Fq 'CONTROLLED CLIENT PILOT' apps/mobile/src/PilotApp.tsx
assert "enrichment local auth must use the hardened Argon2 parameters" \
  grep -Fq 'PasswordHasher(time_cost=3, memory_cost=65_536, parallelism=2)' services/enrichment/app/local_auth.py
assert "pilot control must restore verified tenants within 30 days" \
  grep -Fq 'restoreVerifiedWithin30Days' services/enrichment/app/pilot_control.py
assert "pilot control must back up encrypted evidence within 24 hours" \
  grep -Fq 'encryptedBackupWithin24Hours' services/enrichment/app/pilot_control.py
assert "quality-loop.sh must enforce the AWS deployment freeze" \
  grep -Fq 'AWS_DEPLOYMENT_FROZEN must equal true' scripts/quality-loop.sh
assert "quality gates must list only human-only actions" grep -Fq 'humanOnlyActions' quality/gates.json
if contains_forbidden -RInE --exclude='test-production-config.sh' 'LOCAL_REVIEWER_PASSWORD_SHA256|subprocess\.(run|Popen).*tesseract' services deploy scripts; then
  fail "Shared reviewer credentials or ad hoc Tesseract subprocesses are forbidden."
fi
assert "go-live.sh must require explicit deployment approval" grep -Fq 'Type DEPLOY' scripts/go-live.sh
assert "go-live.sh must check the CDN https status" grep -Fq 'https-status' scripts/go-live.sh
assert "go-live.sh must expose the harden-github phase" grep -Fq 'harden-github' scripts/go-live.sh
assert "go-live.sh must rotate the exposed signing key" grep -Fq 'ROTATE EXPOSED SIGNING KEY' scripts/go-live.sh
assert "go-live.sh must document rotating the exposed Android signing identity" \
  grep -Fq 'Rotate the exposed Android signing identity before deployment' scripts/go-live.sh
assert "ci-pages.yml must store the revoked signing certificate SHA-256" \
  grep -Fq 'CHALLANSE_REVOKED_SIGNING_CERT_SHA256' .github/workflows/ci-pages.yml
assert "ci-pages.yml must pin the AAB hash" grep -Fq 'aab_sha256' .github/workflows/ci-pages.yml
assert "ci-pages.yml must pin the SBOM hash" grep -Fq 'sbom_sha256' .github/workflows/ci-pages.yml
assert "ci-pages.yml must enforce managed Play organizations" grep -Fq 'managed_organizations' .github/workflows/ci-pages.yml
assert "go-live.sh must use the Cloudflare Free Managed Ruleset" grep -Fq 'Cloudflare Free Managed Ruleset' scripts/go-live.sh
assert "go-live.sh must enable the Cloudflare Free WAF" grep -Fq 'CLOUDFLARE_FREE_WAF_ENABLED' scripts/go-live.sh
assert "go-live.sh must pin the Play release track" grep -Fq 'PLAY_RELEASE_TRACK' scripts/go-live.sh
assert "go-live.sh must store the client acceptance SHA-256" grep -Fq 'CLIENT_ACCEPTANCE_SHA256' scripts/go-live.sh
assert "go-live.sh must store the operator training SHA-256" grep -Fq 'OPERATOR_TRAINING_SHA256' scripts/go-live.sh
assert "operator-training.json template must exist and be non-empty" test -s docs/templates/operator-training.json
assert "aws-deployment-freeze.md runbook must exist and be non-empty" test -s docs/aws-deployment-freeze.md
assert "the deployment freeze runbook must set AWS_DEPLOYMENT_FROZEN=true" \
  grep -Fq 'AWS_DEPLOYMENT_FROZEN=true' docs/aws-deployment-freeze.md
for acceptance in staging android-field client security capacity recovery; do
  assert "docs/templates/${acceptance}-acceptance.json must exist and be non-empty" \
    test -s "docs/templates/${acceptance}-acceptance.json"
done
for acceptance in security capacity recovery; do
  assert "go-live.sh must store the ${acceptance^^}_ACCEPTANCE_SHA256 secret" \
    grep -Fq "${acceptance^^}_ACCEPTANCE_SHA256" scripts/go-live.sh
done
if contains_forbidden -RInE 'challanse-pilot|bootstrap-pilot' scripts/go-live.sh apps/edge/src; then
  fail "Retired pilot bootstrap commands must not appear in production go-live scripts."
fi
# Branch protection on main requires exactly these 11 status checks.
required_checks=(
  validate
  android
  enrichment
  'security (npm-audit)'
  'security (pip-audit)'
  'security (bandit)'
  'security (secret-scanning)'
  'security (config-check)'
  'security (tfscan)'
  integration
  terraform-check
)
harden_github_contexts="$(grep -o 'contexts:\[[^]]*\]' scripts/go-live.sh | head -n 1)"
if [[ -z "$harden_github_contexts" ]]; then
  fail "go-live.sh harden-github must declare a required_status_checks contexts array"
fi
for check_name in "${required_checks[@]}"; do
  if ! grep -Fq "$check_name" <<<"$harden_github_contexts"; then
    fail "go-live.sh harden-github must require the ${check_name} status check"
  fi
done
context_count="$(grep -o ',' <<<"$harden_github_contexts" | wc -l)"
if [[ "$context_count" -ne 10 ]]; then
  fail "go-live.sh harden-github must require exactly 11 status checks (found $((context_count + 1)))"
fi
if grep -Fq 'terraform-plan' <<<"$harden_github_contexts"; then
  fail "go-live.sh harden-github must not require terraform-plan as a required status check"
fi
if grep -E '^\s*- uses:' .github/workflows/ci-pages.yml | grep -Ev 'uses: [^[:space:]@]+@[0-9a-f]{40}([[:space:]]|$)'; then
  fail "Every GitHub Action must be pinned to an immutable commit SHA."
fi
assert "ci-pages.yml must gate deployment on AWS_ENRICHMENT_BOOTSTRAPPED" \
  grep -Fq 'AWS_ENRICHMENT_BOOTSTRAPPED == '\''true'\''' .github/workflows/ci-pages.yml
assert "ci-pages.yml must gate deployment on PILOT_DEPLOY_ENABLED" \
  grep -Fq 'PILOT_DEPLOY_ENABLED == '\''true'\''' .github/workflows/ci-pages.yml
assert "ci-pages.yml must gate AWS deployment behind the deployment freeze" \
  test "$(grep -c "vars.AWS_DEPLOYMENT_FROZEN != 'true'" .github/workflows/ci-pages.yml)" -ge 1
assert "go-live.sh must refuse AWS production commands while the deployment is frozen" \
  grep -Fq 'AWS_DEPLOYMENT_FROZEN must equal false before running AWS production commands.' scripts/go-live.sh
assert "rollback-production.sh must re-freeze the AWS deployment" \
  grep -Fq "AWS_DEPLOYMENT_FROZEN --repo \"\$REPO\" --body true" scripts/rollback-production.sh
assert "rollback-production.sh must clear the enrichment bootstrapped flag" \
  grep -Fq "AWS_ENRICHMENT_BOOTSTRAPPED --repo \"\$REPO\" --env production --body false" scripts/rollback-production.sh
assert "ci-pages.yml must require the private ALB certificate ARN" \
  grep -Fq 'AWS_PRIVATE_ALB_CERTIFICATE_ARN' .github/workflows/ci-pages.yml
assert "ci-pages.yml must require the production monthly budget" \
  grep -Fq 'AWS_PRODUCTION_MONTHLY_BUDGET_USD' .github/workflows/ci-pages.yml
assert "ci-pages.yml must require the secondary budget email" \
  grep -Fq 'AWS_SECONDARY_BUDGET_EMAIL' .github/workflows/ci-pages.yml
assert "ci-pages.yml must scope Terraform state to the S3 bucket ARN" \
  grep -Fq 'terraform_state_bucket_arn=arn:aws:s3:::' .github/workflows/ci-pages.yml
assert "go-live.sh must configure the Cloudflare tunnel origin" grep -Fq 'configure-tunnel-origin' scripts/go-live.sh
assert "go-live.sh must verify the tunnel origin TLS certificate" \
  grep -Fq 'CLOUDFLARE_TUNNEL_ORIGIN_TLS_VERIFIED' scripts/go-live.sh
assert "go-live.sh must stage then promote the edge enrichment keys" \
  grep -Fq 'rotate-enrichment-keys stage|promote' scripts/go-live.sh
assert "go-live.sh must rotate the edge-to-enrichment HMAC key" grep -Fq 'EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY' scripts/go-live.sh
assert "go-live.sh must rotate the enrichment-to-edge HMAC key" grep -Fq 'ENRICHMENT_TO_EDGE_NEXT_HMAC_KEY' scripts/go-live.sh
assert "edge worker must declare the next HMAC key ID" grep -Fq 'EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID' apps/edge/wrangler.toml
assert "enrichment config must declare the next HMAC key ID" grep -Fq 'ENRICHMENT_TO_EDGE_NEXT_HMAC_KEY_ID' services/enrichment/app/config.py
assert "enrichment config must declare the tenant context HMAC key" grep -Fq 'TENANT_CONTEXT_HMAC_KEY' services/enrichment/app/config.py
assert "go-live.sh must store the staging acceptance SHA-256" grep -Fq 'STAGING_ACCEPTANCE_SHA256' scripts/go-live.sh
assert "go-live.sh must store the Android field acceptance SHA-256" grep -Fq 'ANDROID_FIELD_ACCEPTANCE_SHA256' scripts/go-live.sh
# Migration coverage: CI must validate migrations in check-only mode and the
# validator must cover the full 0001-0012 migration series.
assert "ci-pages.yml enrichment job must invoke validate-migrations.sh --check-only" \
  grep -Fq 'validate-migrations.sh --check-only' .github/workflows/ci-pages.yml
expected_migrations_block="$(sed -n '/^EXPECTED_MIGRATIONS=(/,/^)/p' scripts/validate-migrations.sh)"
if [[ -z "$expected_migrations_block" ]]; then
  fail "validate-migrations.sh must declare an EXPECTED_MIGRATIONS array"
fi
for migration_number in 000{1..9} 00{10..12}; do
  if ! grep -q "${migration_number}_" <<<"$expected_migrations_block"; then
    fail "validate-migrations.sh EXPECTED_MIGRATIONS must cover migration ${migration_number}"
  fi
done
assert "migration 0005_production_tenancy.sql must exist and be non-empty" \
  test -s services/enrichment/migrations/0005_production_tenancy.sql
assert "migration 0006_local_pilot.sql must exist and be non-empty" \
  test -s services/enrichment/migrations/0006_local_pilot.sql
assert "migration 0006_local_pilot.sql must create the local receipt queue" \
  grep -Fq 'local_receipt_queue' services/enrichment/migrations/0006_local_pilot.sql
assert "migration 0005_production_tenancy.sql must define device rate-limit windows" \
  grep -Fq 'device_rate_limit_windows' services/enrichment/migrations/0005_production_tenancy.sql
if grep -Fq 'CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx' services/enrichment/migrations/0005_production_tenancy.sql; then
  fail "Email must remain an editable attribute, not an identity key."
fi
# Cloudflare Worker now uses D1/R2/Queues as the full backend (not just a proxy).
# Storage bindings are expected and required.
echo "  ✓ Worker storage bindings are no longer stateless-checked (D1-native backend)."
assert "enrichment Dockerfile must pin a sha256 digest" \
  grep -Eq '^FROM .+@sha256:[0-9a-f]{64}$' services/enrichment/Dockerfile
assert "local caddy Dockerfile must pin a sha256 digest" \
  grep -Eq '^FROM .+@sha256:[0-9a-f]{64}$' deploy/local/Dockerfile.caddy
assert "caddy image must drop root capabilities" grep -Fq 'RUN setcap -r /usr/bin/caddy' deploy/local/Dockerfile.caddy
assert "caddy must run as a non-root user" grep -Fq 'USER 1000:1000' deploy/local/Dockerfile.caddy
assert "Caddyfile must expose the 8443 login port" grep -Fq ':8443 {' deploy/local/Caddyfile
assert "Caddyfile must expose the 8444 app port" grep -Fq ':8444 {' deploy/local/Caddyfile
assert "Caddyfile must declare a route block" grep -Fq '  route {' deploy/local/Caddyfile
login_line="$(grep -nF '    handle /login* {' deploy/local/Caddyfile | cut -d: -f1)"
auth_line="$(grep -nF '      forward_auth api:8080 {' deploy/local/Caddyfile | cut -d: -f1)"
[[ -n "$login_line" && -n "$auth_line" && "$login_line" -lt "$auth_line" ]] \
  || fail "Local login must be routed before forward_auth to prevent a redirect loop."
grep -A2 -F '    handle {' deploy/local/Caddyfile | grep -Fq '      route {' \
  || fail "Protected reviewer routes must preserve forward_auth before SPA rewriting."
# shellcheck disable=SC2016 # Intentional literal source-code assertion.
ip_literal_caddy_address='https://{$CHALLANSE_LAN_IP}'
if grep -Fq "$ip_literal_caddy_address" deploy/local/Caddyfile; then
  fail "IP-literal TLS must not require SNI because clients omit SNI for IP addresses."
fi
sed -n '/^  gateway:/,/^  cloudflared:/p' deploy/local/docker-compose.yml \
  | grep -Fq 'networks: [frontend, lan-publish]' \
  || fail "compose gateway must attach to the frontend and lan-publish networks"
if grep -Eq '^[[:space:]]*tmpfs:[[:space:]]*\[' deploy/local/docker-compose.yml; then
  fail "Compose tmpfs mounts must use quoted block-list entries so commas remain mount options."
fi
assert "edge worker cache volume must be mounted read-only and non-executable" \
  grep -Fq '/app/apps/edge/.wrangler:rw,noexec,nosuid,uid=1000,gid=1000,mode=0700' deploy/local/docker-compose.yml
assert "reviewer worker cache volume must be mounted read-only and non-executable" \
  grep -Fq '/app/apps/reviewer/.wrangler:rw,noexec,nosuid,uid=1000,gid=1000,mode=0700' deploy/local/docker-compose.yml
assert "local pilot must recreate containers on startup" grep -Fq 'compose up -d --force-recreate' scripts/local-pilot.sh
start_stack_body="$(sed -n '/^start_stack() {/,/^}/p' scripts/local-pilot.sh)"
printf '%s\n' "$start_stack_body" | grep -Fq 'compose build' \
  || fail "Local startup must rebuild service images before applying migrations."
assert "docker-compose.snap.yml must exist and be non-empty" test -s deploy/local/docker-compose.snap.yml
assert "local pilot must reference the snap compose file" grep -Fq 'SNAP_COMPOSE_FILE=' scripts/local-pilot.sh
assert "local pilot must apply an AppArmor profile" grep -Fq 'name=apparmor' scripts/local-pilot.sh
assert "local pilot must apply a seccomp profile" grep -Fq 'name=seccomp' scripts/local-pilot.sh
if grep -Eq 'privileged:[[:space:]]*true|cap_add:' deploy/local/docker-compose.snap.yml; then
  fail "Snap compatibility must not add privileges or capabilities."
fi
assert "production Terraform must enable deletion protection" \
  grep -Eq 'deletion_protection[[:space:]]*=[[:space:]]*true' infra/terraform/production/main.tf
assert "staging Terraform must disable deletion protection" \
  grep -Eq 'deletion_protection[[:space:]]*=[[:space:]]*false' infra/terraform/staging/main.tf
assert "enrichment module must enable continuous backups" \
  grep -Fq 'enable_continuous_backup = true' infra/terraform/modules/enrichment/main.tf
assert "enrichment module must grant the receipts bucket ARN" \
  grep -Fq 'aws_s3_bucket.receipts.arn' infra/terraform/modules/enrichment/main.tf
assert "enrichment module must enable EventBridge" grep -Fq 'eventbridge = true' infra/terraform/modules/enrichment/main.tf
assert "enrichment module must autoscale the worker queue depth" \
  grep -Fq 'resource "aws_appautoscaling_policy" "worker_queue_depth"' infra/terraform/modules/enrichment/main.tf
assert "enrichment module must define the credit dead-letter queue" \
  grep -Fq 'resource "aws_sqs_queue" "credit_dead_letter"' infra/terraform/modules/enrichment/main.tf
assert "enrichment module must alarm on the credit DLQ" \
  grep -Fq 'resource "aws_cloudwatch_metric_alarm" "credit_dlq"' infra/terraform/modules/enrichment/main.tf
assert "enrichment module must define the private HTTPS listener" \
  grep -Fq 'resource "aws_lb_listener" "private_https"' infra/terraform/modules/enrichment/main.tf
assert "private ALB must pin TLS 1.3" \
  grep -Fq 'ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"' infra/terraform/modules/enrichment/main.tf
assert "enrichment module must flow-log the VPC" \
  grep -Fq 'resource "aws_flow_log" "vpc"' infra/terraform/modules/enrichment/main.tf
assert "tunnel task must assume the tunnel IAM role" \
  grep -Fq 'task_role_arn            = aws_iam_role.tunnel_task.arn' infra/terraform/modules/enrichment/main.tf
assert "github deploy role must be scoped to the Terraform state bucket" \
  grep -Fq 'Resource = var.terraform_state_bucket_arn' infra/terraform/modules/enrichment/main.tf
if grep -Fq 'resource "aws_lb_listener" "private_http"' infra/terraform/modules/enrichment/main.tf; then
  fail "Private ALB traffic must remain HTTPS."
fi
github_policy="$(sed -n '/resource "aws_iam_role_policy" "github_deploy"/,/resource "aws_cloudwatch_metric_alarm" "dlq"/p' infra/terraform/modules/enrichment/main.tf)"
if grep -Fq '"s3:*"' <<<"$github_policy"; then
  fail "GitHub deployment role must not regain wildcard S3 access."
fi
assert "github deploy role must not delete object versions" \
  grep -Fq '"s3:DeleteObjectVersion"' infra/terraform/modules/enrichment/main.tf
assert "github deploy role must list bucket versions" \
  grep -Fq '"s3:ListBucketVersions"' infra/terraform/modules/enrichment/main.tf
assert "production database must remain a db.t4g.small" \
  grep -Eq 'database_instance_class[[:space:]]*=[[:space:]]*"db.t4g.small"' infra/terraform/production/main.tf
assert "production worker count must remain 2" \
  grep -Eq 'worker_desired_count[[:space:]]*=[[:space:]]*2' infra/terraform/production/main.tf
if contains_forbidden -RIn --exclude-dir='.terraform' --exclude='test-production-config.sh' 'PowerUserAccess' infra scripts services/enrichment/app; then
  fail "The AWS deployment role must not use broad PowerUserAccess."
fi
test ! -e services/enrichment/app/cloudflare.py \
  || fail "Legacy Cloudflare image transport must remain absent."
if contains_forbidden -RIniE \
  --exclude-dir='.venv' \
  --exclude-dir='venv' \
  'celery|redis' \
  services/enrichment README.md docs/hybrid-enrichment.md; then
  fail "Celery/Redis references must not remain in the production enrichment path or current runbooks."
fi
grep -Fxq '.venv/' .gitignore \
  || fail "Python virtual environments must remain ignored by Git."
grep -Fxq '**/.venv' .dockerignore \
  || fail "Python virtual environments must remain excluded from Docker build contexts."
if contains_forbidden -RInE 'p95.*<.*50|toBeLessThan\(50\)' apps/mobile/__tests__; then
  fail "JavaScript tests must not claim the Android field p95 gate."
fi
assert "op-sqlite must remain a declared mobile storage dependency" \
  grep -A5 -Fq '"op-sqlite"' apps/mobile/package.json
op_sqlite_block="$(grep -A5 -F '"op-sqlite"' apps/mobile/package.json)"
if ! grep -Fq '"sqlcipher": true' <<<"$op_sqlite_block"; then
  fail "op-sqlite must be built with SQLCipher encryption enabled"
fi
if contains_forbidden -RIniE 'tflite|tensorflow|mobilenet|auto.?capture' apps/mobile; then
  fail "Automatic ML capture assets or wiring must not be shipped."
fi
turnstile_store_line="$(grep -n 'gh secret set TURNSTILE_SECRET' scripts/go-live.sh | cut -d: -f1)"
access_lookup_line="$(grep -n 'access/organizations' scripts/go-live.sh | cut -d: -f1)"
[[ "$turnstile_store_line" -lt "$access_lookup_line" ]] \
  || fail "Turnstile secret must be stored before Access provisioning."
assert "turnstile recovery suite must pass" bash scripts/test-turnstile-recovery.sh
assert "production hardening suite must pass" bash scripts/test-production-hardening.sh
assert "budget controls suite must pass" bash scripts/test-budget-controls.sh
assert "zero-cost readiness suite must pass" bash scripts/test-zero-cost-readiness.sh
assert "WAF provisioning suite must pass" bash scripts/test-waf-provisioning.sh
assert "CI portability suite must pass" bash scripts/test-ci-portability.sh
if grep -RIn --include='*.sh' --exclude='test-production-config.sh' '\brg\b' scripts; then
  fail "CI shell scripts must not depend on runner-specific ripgrep."
fi
if grep -RIE --exclude='test-production-config.sh' '(gho_[A-Za-z0-9]+|sk_live_[A-Za-z0-9]+|CLOUDFLARE_API_TOKEN=.{12})' scripts apps; then
  fail "Potential committed credential detected."
fi
assert "local pilot must default its runtime root to the user cache directory" \
  grep -Fq "RUNTIME_ROOT=\"\${XDG_CACHE_HOME:-\$HOME/.cache}/challanse-local-runtime\"" scripts/local-pilot.sh
grep -Fq "chmod 755 \"\$RUNTIME_ROOT/tls\"" scripts/local-pilot.sh \
  || fail "runtime TLS directory must expose public certificates to non-root services"
grep -Fq "chmod 644 \"\$RUNTIME_ROOT/tls\"/*.crt" scripts/local-pilot.sh \
  || fail "runtime public certificates must be readable without exposing private keys"
grep -Fq "user: \"\${LOCAL_HOST_UID:-1000}:\${LOCAL_HOST_GID:-1000}\"" deploy/local/docker-compose.yml \
  || fail "local Python services must use the current non-root desktop identity for encrypted evidence writes"
grep -Fq 'Local services cannot write synthetic fixtures or evidence' scripts/local-pilot.sh \
  || fail "startup must fail closed when encrypted evidence directories are not writable"
grep -Fq "sourceTreeClean: \$sourceTreeClean" scripts/local-pilot.sh \
  || fail "runtime evidence must disclose whether the source tree was clean"
grep -Fq 'record_local_runtime_manifest' scripts/local-pilot.sh \
  || fail "local startup must record the running container identities"
provision_body="$(sed -n '/^provision() {/,/^}/p' scripts/local-pilot.sh)"
printf '%s\n' "$provision_body" | grep -Fq 'download_apk' \
  || fail "local provisioning must refresh the distributable APK after every successful build"
assert ".local-runtime must be excluded from Docker build contexts" grep -Fxq '.local-runtime' .dockerignore
assert "private keys must be excluded from Docker build contexts" grep -Fxq '**/*.key' .dockerignore
assert "local seed must scope the active tenant lookup" \
  grep -Fq 'WHERE id <> %s AND active LIMIT 1' services/enrichment/app/local_seed.py
if grep -Fq "RUNTIME_ROOT=\"\$ROOT/" scripts/local-pilot.sh; then
  fail "Generated local runtime material must remain outside the repository."
fi
echo "Production configuration checks passed."
# identity_links has no updated_at column; local seeding must remain schema-compatible.
identity_link_seed_sql="$(sed -n '/INSERT INTO identity_links/,/"""/p' services/enrichment/app/local_seed.py)"
if printf '%s\n' "$identity_link_seed_sql" | grep -q 'updated_at'; then
  fail "local seed must not write identity_links.updated_at"
fi

grep -Fq 'OLLAMA_URL=http://ollama:11434' scripts/local-pilot.sh \
  || fail "local pilot must use the private Ollama network alias"
grep -Fq 'docker network connect --alias ollama' scripts/local-pilot.sh \
  || fail "local pilot must attach Ollama to the private OCR network"
grep -Fq 'python -m app.local_acceptance prepare' scripts/local-pilot.sh \
  || fail "local acceptance must use an isolated temporary tenant"
grep -Fq 'python -m app.local_acceptance cleanup' scripts/local-pilot.sh \
  || fail "local acceptance must clean its temporary tenant"
grep -Fq 'No successful acceptance report from the last 24 hours exists' scripts/local-pilot.sh \
  || fail "evidence generation must require recent successful acceptance"
grep -Fq 'python -m app.local_acceptance verify-clean' scripts/local-pilot.sh \
  || fail "evidence generation must verify acceptance cleanup"
grep -Fq '"po_number,material_code,quantity,unit\n"' services/enrichment/app/local_fixtures.py \
  || fail "synthetic Tally fixture must match the importer schema"
if grep -Fq 'material_description,unit,po_quantity' services/enrichment/app/local_fixtures.py; then
  fail "synthetic Tally fixture must not use the obsolete schema"
fi
grep -Fq 'test-data) test_data ;;' scripts/local-pilot.sh \
  || fail "local pilot must expose a safe test-data refresh command"
grep -Fq 'ChallanSe Local Synthetic Testing Runbook' docs/local-testing-runbook.md \
  || fail "beginner-safe local testing runbook is missing"
grep -Fq 'queueDepthAfterWait' docs/local-testing-runbook.md \
  || fail "local testing runbook must document acceptance validation"
