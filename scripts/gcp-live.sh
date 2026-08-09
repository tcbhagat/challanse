#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-help}"
ENVIRONMENT="${2:-staging}"
REGION="asia-south1"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null || fail "Required command not found: $1"; }
require_clean() { test -z "$(git -C "$ROOT" status --porcelain)" || fail "Git working tree must be clean."; }
project_id() { local name="GCP_${ENVIRONMENT^^}_PROJECT_ID"; printf '%s' "${!name:-}"; }
state_bucket() { local name="GCP_${ENVIRONMENT^^}_TERRAFORM_STATE_BUCKET"; printf '%s' "${!name:-}"; }
image_record() { printf '/tmp/challanse-gcp-%s-image.txt' "$ENVIRONMENT"; }

assert_environment() {
  [[ "$ENVIRONMENT" =~ ^(staging|production)$ ]] || fail "Environment must be staging or production."
}

assert_frozen() {
  test "${AWS_DEPLOYMENT_FROZEN:-true}" = "true" || fail "AWS_DEPLOYMENT_FROZEN must remain true."
  test "${PILOT_DEPLOY_ENABLED:-false}" = "false" || fail "PILOT_DEPLOY_ENABLED must remain false."
}

require_project() {
  local project bucket
  project="$(project_id)"
  bucket="$(state_bucket)"
  test -n "$project" || fail "Set GCP_${ENVIRONMENT^^}_PROJECT_ID."
  test -n "$bucket" || fail "Set GCP_${ENVIRONMENT^^}_TERRAFORM_STATE_BUCKET."
  printf '%s' "$project"
}

require_tfvars() {
  local vars="${GCP_TFVARS_FILE:-}"
  test -f "$vars" || fail "Set GCP_TFVARS_FILE to a private .tfvars file."
  printf '%s' "$vars"
}

preflight() {
  assert_environment
  assert_frozen
  for command in gcloud firebase terraform docker jq npm python3 git gh; do require "$command"; done
  gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . || fail "Run: gcloud auth login"
  local project
  project="$(require_project)"
  gcloud projects describe "$project" --format='value(projectId)' | grep -qx "$project" || fail "GCP project is unavailable."
  printf 'GCP %s preflight passed. AWS remains frozen.\n' "$ENVIRONMENT"
}

init_backend() {
  local bucket
  bucket="$(state_bucket)"
  terraform -chdir="$ROOT/infra/gcp" init -reconfigure \
    -backend-config="bucket=$bucket" \
    -backend-config="prefix=challanse/$ENVIRONMENT"
}

bootstrap_state() {
  preflight
  local project bucket phrase
  project="$(project_id)"
  bucket="$(state_bucket)"
  if gcloud storage buckets describe "gs://$bucket" --project "$project" >/dev/null 2>&1; then
    verify_state_bucket "$project" "$bucket"
    printf 'Verified existing Terraform state bucket: gs://%s\n' "$bucket"
    return
  fi
  read -r -p "Type CREATE STATE ${ENVIRONMENT} ${project}: " phrase
  test "$phrase" = "CREATE STATE ${ENVIRONMENT} ${project}" || fail "Confirmation did not match."
  gcloud storage buckets create "gs://$bucket" --project "$project" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "gs://$bucket" --project "$project" --versioning
  verify_state_bucket "$project" "$bucket"
  printf 'Created versioned private Terraform state bucket: gs://%s\n' "$bucket"
}

verify_state_bucket() {
  local project="$1" bucket="$2" details expected_project_number
  details="$(gcloud storage buckets describe "gs://$bucket" --project "$project" --format=json)"
  expected_project_number="$(gcloud projects describe "$project" --format='value(projectNumber)')"
  jq -e --arg region "${REGION^^}" --arg project_number "$expected_project_number" '
    (.location | ascii_upcase) == $region and
    .iamConfiguration.uniformBucketLevelAccess.enabled == true and
    .iamConfiguration.publicAccessPrevention == "enforced" and
    .versioning.enabled == true and
    (.projectNumber | tostring) == $project_number
  ' <<<"$details" >/dev/null || fail "Existing state bucket does not meet ownership, region, privacy, or versioning requirements."
}

plan_bootstrap() {
  preflight
  local vars
  vars="$(require_tfvars)"
  init_backend
  terraform -chdir="$ROOT/infra/gcp" validate
  terraform -chdir="$ROOT/infra/gcp" plan -var-file="$vars" \
    -var='bootstrap_only=true' -var='container_image=' \
    -out="/tmp/challanse-${ENVIRONMENT}-bootstrap.tfplan"
  printf 'Bootstrap plan created. Nothing was applied.\n'
}

apply_bootstrap() {
  require_clean
  plan_bootstrap
  local sha phrase
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  read -r -p "Type APPLY BOOTSTRAP ${ENVIRONMENT} ${sha}: " phrase
  test "$phrase" = "APPLY BOOTSTRAP ${ENVIRONMENT} ${sha}" || fail "Confirmation did not match."
  terraform -chdir="$ROOT/infra/gcp" apply "/tmp/challanse-${ENVIRONMENT}-bootstrap.tfplan"
}

build_image() {
  require_clean
  preflight
  local project sha tagged_image digest immutable_image
  project="$(project_id)"
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  tagged_image="$REGION-docker.pkg.dev/$project/challanse/api:$sha"
  gcloud builds submit "$ROOT/services/gcp-api" --project "$project" --tag "$tagged_image"
  digest="$(gcloud artifacts docker images describe "$tagged_image" --project "$project" --format='value(image_summary.digest)')"
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "Artifact Registry did not return an image digest."
  immutable_image="${tagged_image%:*}@$digest"
  printf '%s\n' "$immutable_image" >"$(image_record)"
  chmod 600 "$(image_record)"
  printf 'Immutable image recorded at %s\n' "$(image_record)"
}

require_image() {
  local record image
  record="$(image_record)"
  test -f "$record" || fail "Run build-image $ENVIRONMENT first."
  image="$(cat "$record")"
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || fail "Recorded image is not immutable."
  printf '%s' "$image"
}

check_billing_secrets() {
  test "${GCP_BILLING_ENABLED:-false}" = "true" || return 0
  local project secret
  project="$(project_id)"
  for secret in challanse-razorpay-key-id challanse-razorpay-key-secret challanse-razorpay-plan-id challanse-razorpay-webhook-secret; do
    gcloud secrets versions list "$secret" --project "$project" --filter='state=ENABLED' --format='value(name)' | grep -q . || fail "Missing enabled version for $secret."
  done
}

plan_application() {
  preflight
  local vars image
  vars="$(require_tfvars)"
  image="$(require_image)"
  check_billing_secrets
  init_backend
  terraform -chdir="$ROOT/infra/gcp" plan -var-file="$vars" \
    -var='bootstrap_only=false' \
    -var="billing_enabled=${GCP_BILLING_ENABLED:-false}" \
    -var="container_image=$image" \
    -out="/tmp/challanse-${ENVIRONMENT}-application.tfplan"
  printf 'Application plan created. Nothing was applied.\n'
}

load_client_environment() {
  local env_file="${GCP_CLIENT_ENV_FILE:-}"
  test -f "$env_file" || fail "Set GCP_CLIENT_ENV_FILE to the private Firebase web environment file."
  if grep -Ev '^[[:space:]]*(#.*)?$|^VITE_[A-Z0-9_]+=[A-Za-z0-9_./:+-]+$' "$env_file" | grep -q .; then
    fail "Client environment file contains unsupported syntax."
  fi
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

deploy_application() {
  require_clean
  plan_application
  local sha phrase project
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  project="$(project_id)"
  require_ci_success "$sha"
  if test "$ENVIRONMENT" = "production"; then
    test "${GCP_PRODUCTION_APPROVED:-false}" = "true" || fail "Production approval evidence is missing."
    test "$(git -C "$ROOT" branch --show-current)" = "main" || fail "Production deploys only from main."
  fi
  read -r -p "Type DEPLOY ${ENVIRONMENT} ${sha}: " phrase
  test "$phrase" = "DEPLOY ${ENVIRONMENT} ${sha}" || fail "Confirmation did not match."
  terraform -chdir="$ROOT/infra/gcp" apply "/tmp/challanse-${ENVIRONMENT}-application.tfplan"
  load_client_environment
  npm --prefix "$ROOT" run build --workspace @challanse/client
  firebase deploy --only hosting,firestore:rules,storage --project "$project"
}

require_ci_success() {
  local sha="$1" conclusion
  conclusion="$(gh run list --repo tcbhagat/challanse --workflow ci-pages.yml --commit "$sha" --limit 1 --json status,conclusion --jq '.[0] | select(.status == "completed" and .conclusion == "success") | .conclusion')"
  test "$conclusion" = "success" || fail "CI for the exact deployment commit is not successful."
}

case "$COMMAND" in
  preflight) preflight ;;
  bootstrap-state) bootstrap_state ;;
  plan-bootstrap) plan_bootstrap ;;
  apply-bootstrap) apply_bootstrap ;;
  build-image) build_image ;;
  plan-application) plan_application ;;
  deploy-staging) ENVIRONMENT=staging; deploy_application ;;
  deploy-production) ENVIRONMENT=production; deploy_application ;;
  *) printf '%s\n' "Usage: $0 {preflight|bootstrap-state|plan-bootstrap|apply-bootstrap|build-image|plan-application|deploy-staging|deploy-production} [staging|production]" ;;
esac
