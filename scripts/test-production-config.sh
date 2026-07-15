#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
bash -n scripts/go-live.sh
bash -n scripts/rollback-production.sh
bash -n scripts/test-turnstile-recovery.sh
bash -n scripts/test-production-hardening.sh
shellcheck -e SC1090 scripts/go-live.sh scripts/rollback-production.sh scripts/test-production-config.sh scripts/test-turnstile-recovery.sh scripts/test-production-hardening.sh
test -x scripts/go-live.sh
test -x scripts/rollback-production.sh
grep -Fq "VITE_API_BASE_URL: /api" .github/workflows/ci-pages.yml
grep -Fq 'API_ORIGIN = "https://api.challanse.constrovet.com"' apps/reviewer/wrangler.toml
grep -Fq "Cf-Access-Jwt-Assertion" apps/reviewer/src/worker.ts
grep -Fq 'dns-onboard' scripts/go-live.sh
grep -Fq 'dns-status' scripts/go-live.sh
grep -Fq 'dns-accept' scripts/go-live.sh
grep -Fq '34.102.192.38' scripts/go-live.sh
grep -Fq 'tcbhagat.github.io' scripts/go-live.sh
grep -Fq 'alt4.aspmx.l.google.com' scripts/go-live.sh
grep -Fq 'DNS_ACCEPTED_AT' scripts/go-live.sh
grep -Fq 'Cloudflare error details:' scripts/go-live.sh
grep -Fq 'Account > Zone > Edit' scripts/go-live.sh
grep -Fq 'Zone > Dynamic URL Redirects > Edit' scripts/go-live.sh
grep -Fq 'https://www.constrovet.com/app/' scripts/go-live.sh
grep -Fq 'APP REDIRECT OK' scripts/go-live.sh
grep -Fq 'invalidate_immediately' scripts/go-live.sh
grep -Fq 'ROTATE DEVICE PEPPER' scripts/go-live.sh
grep -Fq 'CHALLANSE_SIGNING_CERT_SHA256' scripts/go-live.sh
grep -Fq 'Type DEPLOY' scripts/go-live.sh
grep -Fq 'https-status' scripts/go-live.sh
grep -Fq 'harden-github' scripts/go-live.sh
turnstile_store_line="$(grep -n 'gh secret set TURNSTILE_SECRET' scripts/go-live.sh | cut -d: -f1)"
access_lookup_line="$(grep -n 'access/organizations' scripts/go-live.sh | cut -d: -f1)"
[[ "$turnstile_store_line" -lt "$access_lookup_line" ]] || { echo "Turnstile secret must be stored before Access provisioning." >&2; exit 1; }
bash scripts/test-turnstile-recovery.sh
bash scripts/test-production-hardening.sh
if grep -RIE --exclude='test-production-config.sh' '(gho_[A-Za-z0-9]+|sk_live_[A-Za-z0-9]+|CLOUDFLARE_API_TOKEN=.{12})' scripts apps; then
  echo "Potential committed credential detected." >&2
  exit 1
fi
echo "Production configuration checks passed."
