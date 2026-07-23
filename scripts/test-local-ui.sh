#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run check --workspace @challanse/reviewer
npm run test --workspace @challanse/reviewer
npm run build --workspace @challanse/reviewer
npm run test:browser

if [[ "$(findmnt -n -o SOURCE --mountpoint /mnt/challanse-data 2>/dev/null || true)" == "/dev/mapper/challanse-local" ]]; then
  evidence_root="/mnt/challanse-data/exports/ui-validation/latest"
  source_clean=true
  [[ -z "$(git status --porcelain)" ]] || source_clean=false
  mkdir -p "$evidence_root"
  jq -n \
    --arg commit "$(git rev-parse HEAD)" \
    --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson sourceTreeClean "$source_clean" \
    '{
      passed: true,
      synthetic: true,
      commitSha: $commit,
      sourceTreeClean: $sourceTreeClean,
      generatedAt: $generatedAt,
      browsers: ["chromium", "firefox"],
      viewports: ["390x844", "768x1024", "1440x900"],
      accessibility: "axe checks passed",
      limitations: "Mocked browser API journeys plus separate authenticated LAN acceptance"
    }' >"$evidence_root/ui-validation.json"
  cp tests/browser/local-ui.spec.ts-snapshots/operator-readiness-chromium-desktop-linux.png \
    "$evidence_root/operator-desktop.png"
  cp tests/browser/local-ui.spec.ts-snapshots/operator-readiness-chromium-mobile-linux.png \
    "$evidence_root/operator-mobile.png"
fi

printf 'Local operator and reviewer UI gates passed.\n'
