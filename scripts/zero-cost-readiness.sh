#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="tcbhagat/challanse"
TERRAFORM_VERSION="1.9.8"
STAGING_ACCOUNT_EMAIL="bhagat.taran+aws-staging@gmail.com"
PRODUCTION_ACCOUNT_EMAIL="bhagat.taran+aws-production@gmail.com"
RECOVERY_ACCOUNT_EMAIL="bhagat.taran+aws-recovery@gmail.com"
PRIMARY_BUDGET_EMAIL="admin@constrovet.com"
SECONDARY_BUDGET_EMAIL="bhagat.nikita14@gmail.com"
ZERO_DIGEST="$(printf '0%.0s' {1..64})"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"; }

production_disabled() {
  [[ "$(gh variable get PILOT_DEPLOY_ENABLED --repo "$REPO" 2>/dev/null || true)" == "false" ]]
}

aws_deployment_frozen() {
  [[ "$(gh variable get AWS_DEPLOYMENT_FROZEN --repo "$REPO" 2>/dev/null || true)" == "true" ]]
}

require_production_disabled() {
  production_disabled || die "PILOT_DEPLOY_ENABLED must exist and equal false."
}

require_aws_deployment_frozen() {
  aws_deployment_frozen || die "AWS_DEPLOYMENT_FROZEN must exist and equal true."
}

aws_bootstrap_disabled() {
  [[ "$(gh variable get AWS_ENRICHMENT_BOOTSTRAPPED --repo "$REPO" --env production 2>/dev/null || true)" == "false" ]]
}

freeze_status() {
  for command in gh jq; do need "$command"; done
  require_production_disabled
  require_aws_deployment_frozen
  aws_bootstrap_disabled || die "AWS_ENRICHMENT_BOOTSTRAPPED must exist and equal false in the production environment."
  local run_id active_run_ids active_deployments='[]' jobs
  active_run_ids="$(gh run list --repo "$REPO" --workflow ci-pages.yml --limit 50 --json databaseId,status \
    --jq '.[] | select(.status == "queued" or .status == "in_progress") | .databaseId')"
  while IFS= read -r run_id; do
    [[ -n "$run_id" ]] || continue
    jobs="$(gh run view "$run_id" --repo "$REPO" --json jobs --jq '[.jobs[] | select((.name | startswith("deploy-")) or .name == "release-android") | select(.status == "queued" or .status == "in_progress") | {run:'"$run_id"',job:.name,status:.status}]')"
    active_deployments="$(jq -c --argjson jobs "$jobs" '. + $jobs' <<<"$active_deployments")"
  done <<<"$active_run_ids"
  [[ "$(jq 'length' <<<"$active_deployments")" == "0" ]] || die "A production deployment job is queued or running: $active_deployments"
  printf '%s\n' 'AWS deployment freeze verified: pilot=false, enrichment=false, frozen=true, active deployment jobs=0.'
}

install_terraform() {
  for command in curl unzip sha256sum sudo jq; do need "$command"; done
  if command -v terraform >/dev/null 2>&1 && terraform version -json | jq -e --arg version "$TERRAFORM_VERSION" '.terraform_version == $version' >/dev/null; then
    printf 'Terraform %s is already installed.\n' "$TERRAFORM_VERSION"
    return
  fi
  local temporary archive sums
  temporary="$(mktemp -d)"
  trap 'rm -rf "$temporary"' RETURN
  archive="terraform_${TERRAFORM_VERSION}_linux_amd64.zip"
  sums="terraform_${TERRAFORM_VERSION}_SHA256SUMS"
  curl -fsSLo "$temporary/$archive" "https://releases.hashicorp.com/terraform/$TERRAFORM_VERSION/$archive"
  curl -fsSLo "$temporary/$sums" "https://releases.hashicorp.com/terraform/$TERRAFORM_VERSION/$sums"
  (cd "$temporary" && grep " $archive\$" "$sums" | sha256sum -c -)
  sudo unzip -o "$temporary/$archive" -d /usr/local/bin >/dev/null
  /usr/local/bin/terraform version
}

aws_org_status() {
  need aws
  printf 'Current AWS identity:\n'
  aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table
  printf 'Root safety:\n'
  aws iam get-account-summary --query 'SummaryMap.{MFA:AccountMFAEnabled,AccessKeys:AccountAccessKeysPresent}' --output table
  if aws organizations describe-organization >/dev/null 2>&1; then
    aws organizations list-accounts --query 'Accounts[].{Name:Name,Status:Status}' --output table
  else
    printf '%s\n' 'No AWS Organization exists yet.'
  fi
}

create_member_account() {
  local name="$1" email="$2" existing existing_email request state failure
  existing="$(aws organizations list-accounts --query "Accounts[?Name=='$name' || Email=='$email'].Id | [0]" --output text)"
  if [[ -n "$existing" && "$existing" != "None" ]]; then
    existing_email="$(aws organizations list-accounts --query "Accounts[?Id=='$existing'].Email | [0]" --output text)"
    [[ "$existing_email" == "$email" ]] || die "$name or $email is already attached to a different Organization account."
    printf '%s already exists.\n' "$name"
    return
  fi
  request="$(aws organizations list-create-account-status --states IN_PROGRESS --query "CreateAccountStatuses[?AccountName=='$name'].Id | [0]" --output text)"
  if [[ -z "$request" || "$request" == "None" ]]; then
    request="$(aws organizations create-account --email "$email" --account-name "$name" --role-name OrganizationAccountAccessRole --query 'CreateAccountStatus.Id' --output text)"
  fi
  for _ in {1..60}; do
    state="$(aws organizations describe-create-account-status --create-account-request-id "$request" --query 'CreateAccountStatus.State' --output text)"
    case "$state" in
      SUCCEEDED) printf '%s created.\n' "$name"; return ;;
      FAILED)
        failure="$(aws organizations describe-create-account-status --create-account-request-id "$request" --query 'CreateAccountStatus.FailureReason' --output text)"
        die "$name creation failed: $failure"
        ;;
    esac
    sleep 10
  done
  die "$name creation did not finish within ten minutes. Re-run status before retrying."
}

aws_org_bootstrap() {
  need aws
  local arn mfa access_keys alias_confirmation confirmation
  arn="$(aws sts get-caller-identity --query Arn --output text)"
  [[ "$arn" == *':root' ]] || die "Initial Organization bootstrap must use the current root login session."
  mfa="$(aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled' --output text)"
  access_keys="$(aws iam get-account-summary --query 'SummaryMap.AccountAccessKeysPresent' --output text)"
  [[ "$mfa" == "1" && "$access_keys" == "0" ]] || die "Root MFA must be enabled and root access keys must be absent."
  read -r -p 'Confirm all three Gmail plus-address variants receive mail. Type EMAIL VARIANTS VERIFIED: ' alias_confirmation
  [[ "$alias_confirmation" == "EMAIL VARIANTS VERIFIED" ]] || die "AWS account email verification was not confirmed."
  read -r -p 'Create the AWS Organization and three empty member accounts. Type CREATE AWS ORGANIZATION: ' confirmation
  [[ "$confirmation" == "CREATE AWS ORGANIZATION" ]] || die "AWS Organization bootstrap cancelled."
  if ! aws organizations describe-organization >/dev/null 2>&1; then
    aws organizations create-organization --feature-set ALL >/dev/null
  fi
  create_member_account "ChallanSe Staging" "$STAGING_ACCOUNT_EMAIL"
  create_member_account "ChallanSe Production" "$PRODUCTION_ACCOUNT_EMAIL"
  create_member_account "ChallanSe Recovery" "$RECOVERY_ACCOUNT_EMAIL"
  aws organizations list-accounts --query 'Accounts[].{Name:Name,Status:Status}' --output table
  printf '%s\n' 'No workload resources were created. Configure IAM Identity Center and MFA before continuing.'
}

cleanup_local_staging() {
  docker stop challanse-postgres challanse-localstack >/dev/null 2>&1 || true
  docker rm challanse-postgres challanse-localstack >/dev/null 2>&1 || true
  rm -rf /tmp/challanse-venv
}

local_staging() {
  for command in gh git npm node docker python3; do need "$command"; done
  require_production_disabled
  cd "$ROOT"
  [[ "$(git branch --show-current)" == "main" ]] || die "Switch to main before running local staging."
  [[ -z "$(git status --short --untracked-files=no)" ]] || die "Tracked working tree changes must be committed or reverted first."
  cleanup_local_staging
  trap cleanup_local_staging EXIT
  npm ci
  npm run check
  npm test
  npm run build
  local postgres_port localstack_port
  docker run -d --name challanse-postgres -e POSTGRES_DB=challanse_test -e POSTGRES_USER=challanse -e POSTGRES_PASSWORD=challanse-test-only -p 127.0.0.1::5432 postgres:17.5 >/dev/null
  docker run -d --name challanse-localstack -e SERVICES=sqs,kms,textract -p 127.0.0.1::4566 localstack/localstack:4.6.0 >/dev/null
  postgres_port="$(docker port challanse-postgres 5432/tcp | awk -F: 'NR == 1 {print $NF}')"
  localstack_port="$(docker port challanse-localstack 4566/tcp | awk -F: 'NR == 1 {print $NF}')"
  [[ "$postgres_port" =~ ^[0-9]+$ && "$localstack_port" =~ ^[0-9]+$ ]] || die "Could not determine local synthetic service ports."
  for _ in {1..40}; do
    if docker exec challanse-postgres pg_isready -U challanse -d challanse_test >/dev/null 2>&1; then break; fi
    sleep 3
  done
  docker exec challanse-postgres pg_isready -U challanse -d challanse_test >/dev/null || die "Local PostgreSQL did not become ready."
  python3 -m venv /tmp/challanse-venv
  /tmp/challanse-venv/bin/pip install --quiet --requirement services/enrichment/requirements-dev.txt
  TEST_DATABASE_URL="postgresql://challanse:challanse-test-only@127.0.0.1:${postgres_port}/challanse_test" \
    TENANT_CONTEXT_HMAC_KEY="$(printf '%s' 'challanse-test-tenant-context' | sha256sum | awk '{print $1}')" \
    AWS_ENDPOINT_URL="http://127.0.0.1:${localstack_port}" AWS_ACCESS_KEY_ID='test' AWS_SECRET_ACCESS_KEY='test' \
    AWS_DEFAULT_REGION='ap-south-1' PYTHONPATH=services/enrichment \
    /tmp/challanse-venv/bin/python -m pytest -q services/enrichment/tests -m integration
  printf '%s\n' 'Zero-cost local staging passed. Synthetic containers are being removed.'
}

fixed_cost_resource_types() {
  jq -r '[.resource_changes[]? | select(.change.actions | index("create")) | .type] | unique[] | select(. == "aws_nat_gateway" or . == "aws_lb" or . == "aws_db_instance" or . == "aws_ecs_service")'
}

speculative_plan() {
  for command in aws gh jq terraform; do need "$command"; done
  require_production_disabled
  local profile="${AWS_PROFILE:-challanse-staging}" account_id plan plan_json fixed_types
  account_id="$(aws sts get-caller-identity --profile "$profile" --query Account --output text)"
  [[ "$account_id" =~ ^[0-9]{12}$ ]] || die "Could not verify the staging AWS account through profile $profile."
  plan="/tmp/challanse-staging.tfplan"
  plan_json="/tmp/challanse-staging.tfplan.json"
  terraform -chdir="$ROOT/infra/terraform/staging" init -backend=false
  terraform -chdir="$ROOT/infra/terraform/staging" validate
  AWS_PROFILE="$profile" terraform -chdir="$ROOT/infra/terraform/staging" plan -refresh=false -lock=false -out="$plan" \
    -var="container_image=${account_id}.dkr.ecr.ap-south-1.amazonaws.com/challanse-staging@sha256:${ZERO_DIGEST}" \
    -var="adot_collector_image=public.ecr.aws/aws-observability/aws-otel-collector@sha256:${ZERO_DIGEST}" \
    -var="cloudflared_image=cloudflare/cloudflared@sha256:${ZERO_DIGEST}" \
    -var="certificate_arn=arn:aws:acm:ap-south-1:${account_id}:certificate/00000000-0000-0000-0000-000000000000" \
    -var="terraform_state_bucket_arn=arn:aws:s3:::challanse-staging-plan-only-${account_id}" \
    -var="expected_aws_account_id=${account_id}" \
    -var="monthly_budget_usd=225" \
    -var="budget_email=${PRIMARY_BUDGET_EMAIL}" \
    -var="secondary_budget_email=${SECONDARY_BUDGET_EMAIL}" \
    -var="github_oidc_provider_arn=arn:aws:iam::${account_id}:oidc-provider/token.actions.githubusercontent.com" \
    -var="services_enabled=false"
  terraform -chdir="$ROOT/infra/terraform/staging" show -json "$plan" > "$plan_json"
  fixed_types="$(fixed_cost_resource_types < "$plan_json")"
  printf 'Speculative plan: %s\n' "$plan"
  printf 'Plan inventory: %s\n' "$plan_json"
  if [[ -n "$fixed_types" ]]; then
    printf 'Rejected for the zero-cost target. Fixed-cost resource types:\n%s\n' "$fixed_types"
    printf '%s\n' 'Do not apply this plan.'
    return
  fi
  die "The fixed-cost detector found no expected billable resources; review the plan manually before any future approval."
}

usage() {
  cat <<'USAGE'
Usage: scripts/zero-cost-readiness.sh <command>
  freeze-status
  status
  install-terraform
  aws-org-bootstrap
  local-staging
  speculative-plan

This script never applies Terraform or runs a ChallanSe production deployment.
AWS Organization bootstrap is unavailable while AWS_DEPLOYMENT_FROZEN=true.
USAGE
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    freeze-status) freeze_status ;;
    status) require_production_disabled; require_aws_deployment_frozen; aws_org_status ;;
    install-terraform) install_terraform ;;
    aws-org-bootstrap) require_production_disabled; aws_deployment_frozen && die "AWS deployment is frozen; Organization bootstrap is disabled."; aws_org_bootstrap ;;
    local-staging) local_staging ;;
    speculative-plan) speculative_plan ;;
    help|-h|--help|'') usage ;;
    *) usage >&2; exit 1 ;;
  esac
fi
