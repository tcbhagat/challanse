# ChallanSe Client-Facing Repair Evidence

Date: 2026-08-08

## Scope

This evidence covers the public, account-free fictional invoice demonstration and the existing local application regression surface. It does not claim that verified guest processing, public real-invoice upload, or Android real-device acceptance is complete.

## Passed checks

- `npm run check:html`
- `npm run check:js`
- `npm run build:landing`
- `npm run test:landing` — 4 tests passed
- `PLAYWRIGHT_BROWSERS_PATH=/media/taran/LargeStorage/taran/playwright-browsers npm run test:landing:browser` — 15 passed, 3 intentionally skipped by viewport conditions
- `npm run check`
- `npm test` — edge 29, mobile 6, reviewer 12, and contract 2 tests passed
- `npm run build`
- `npm run build --workspace @challanse/mobile` — Android debug build successful
- `PYTHONPATH="$PWD/services/enrichment" services/enrichment/.venv/bin/python -m pytest -q services/enrichment/tests/test_local_pilot.py services/enrichment/tests/test_workflows.py` — 85 passed, 17 skipped
- `git diff --check`

## Browser coverage

- Chromium desktop at 1440 by 900
- Chromium mobile at 390 by 844
- Firefox desktop at 1440 by 900
- Fictional sample selection and deterministic result
- Desktop and mobile navigation
- Workflow tabs by pointer and keyboard
- Contact routing with `interest=challanse`
- No serious or critical axe findings in the tested landing workflow

## Release blockers

- `npm audit --omit=dev --audit-level=high` reports 9 high vulnerabilities and 0 critical vulnerabilities in the current React Native and Metro dependency chain.
- The verified-email guest workspace for private real invoices is not implemented.
- No Android device is connected, so offline capture, SQLCipher behavior, restart recovery, resumable synchronization, and revocation remain unverified on hardware.
- The public live site still serves an older asset version until a reviewed branch is merged and the static landing deployment completes.
- Reviewer and API services remain local-only and must not be exposed through public DNS.

## Safety result

The public demonstration uses fixed fictional values, performs no upload, makes no API request, and stores nothing in browser storage. The real-invoice action routes to the existing ChallanSe-interest contact page rather than accepting sensitive data without verification.
