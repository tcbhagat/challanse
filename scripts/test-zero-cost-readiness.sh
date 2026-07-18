#!/usr/bin/env bash
# shellcheck disable=SC1091
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/zero-cost-readiness.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

[[ "$STAGING_ACCOUNT_EMAIL" == "bhagat.taran+aws-staging@gmail.com" ]] || fail "staging account email changed"
[[ "$PRODUCTION_ACCOUNT_EMAIL" == "bhagat.taran+aws-production@gmail.com" ]] || fail "production account email changed"
[[ "$RECOVERY_ACCOUNT_EMAIL" == "bhagat.taran+aws-recovery@gmail.com" ]] || fail "recovery account email changed"
[[ "$PRIMARY_BUDGET_EMAIL" == "admin@constrovet.com" ]] || fail "primary budget email changed"
[[ "$SECONDARY_BUDGET_EMAIL" == "bhagat.nikita14@gmail.com" ]] || fail "secondary budget email changed"

gh() { printf '%s\n' false; }
production_disabled || fail "explicit false deployment flag was rejected"
gh() { printf '%s\n' true; }
if production_disabled; then fail "enabled production flag was accepted"; fi
gh() { return 1; }
if production_disabled; then fail "missing production flag was accepted"; fi

gh() { [[ "$3" == "AWS_DEPLOYMENT_FROZEN" ]] && printf '%s\n' true || printf '%s\n' false; }
aws_deployment_frozen || fail "explicit AWS freeze flag was rejected"
gh() { printf '%s\n' false; }
if aws_deployment_frozen; then fail "disabled AWS freeze flag was accepted"; fi
gh() { return 1; }
if aws_deployment_frozen; then fail "missing AWS freeze flag was accepted"; fi

gh() {
  case "$*" in
    'variable get PILOT_DEPLOY_ENABLED '*) printf '%s\n' false ;;
    'variable get AWS_DEPLOYMENT_FROZEN '*) printf '%s\n' true ;;
    'variable get AWS_ENRICHMENT_BOOTSTRAPPED '*) printf '%s\n' false ;;
    'run list '*) printf '%s' '' ;;
    *) return 1 ;;
  esac
}
freeze_status >/dev/null || fail "valid deployment freeze status was rejected"

plan_fixture='{"resource_changes":[{"type":"aws_s3_bucket","change":{"actions":["create"]}},{"type":"aws_nat_gateway","change":{"actions":["create"]}},{"type":"aws_lb","change":{"actions":["create"]}},{"type":"aws_db_instance","change":{"actions":["create"]}},{"type":"aws_ecs_service","change":{"actions":["create"]}}]}'
fixed_types="$(fixed_cost_resource_types <<<"$plan_fixture")"
for expected in aws_nat_gateway aws_lb aws_db_instance aws_ecs_service; do
  grep -Fxq "$expected" <<<"$fixed_types" || fail "$expected was not classified as fixed cost"
done
grep -Fq 'EMAIL VARIANTS VERIFIED' "$ROOT/scripts/zero-cost-readiness.sh" || fail "email variant confirmation is missing"
grep -Fq 'AWS deployment is frozen; Organization bootstrap is disabled.' "$ROOT/scripts/zero-cost-readiness.sh" || fail "organization bootstrap freeze guard is missing"
grep -Fq 'freeze-status' "$ROOT/scripts/zero-cost-readiness.sh" || fail "freeze status command is missing"
grep -Fq 'CREATE AWS ORGANIZATION' "$ROOT/scripts/zero-cost-readiness.sh" || fail "organization confirmation is missing"
grep -Fq '127.0.0.1::5432' "$ROOT/scripts/zero-cost-readiness.sh" || fail "PostgreSQL does not use a dynamic localhost port"
grep -Fq '127.0.0.1::4566' "$ROOT/scripts/zero-cost-readiness.sh" || fail "LocalStack does not use a dynamic localhost port"
if grep -Eq '^[[:space:]]*terraform[[:space:]]+apply|^[[:space:]]*[^#]*go-live\.sh[[:space:]]+deploy' "$ROOT/scripts/zero-cost-readiness.sh"; then
  fail "zero-cost script contains a deployment command"
fi

printf '%s\n' 'Zero-cost readiness checks passed.'
