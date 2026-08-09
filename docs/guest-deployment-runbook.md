# Guest Service Deployment Runbook

This runbook is review-only. Do not deploy while `PILOT_DEPLOY_ENABLED=false`.

## Prerequisites

1. Confirm `AWS_DEPLOYMENT_FROZEN=true` and no AWS job is enabled.
2. Confirm the Cloudflare account is on Workers Free and paid overages are unavailable.
3. Create `guest.challanse.constrovet.com` as a custom domain for the reviewer-assets Worker.
4. Create a separate Cloudflare Access self-hosted application for the guest hostname.
5. Enable One-time PIN and an Access policy that permits any validated email address. Keep the existing reviewer policy unchanged.
6. Set the guest application audience in `GUEST_ACCESS_AUD`. Keep the reviewer audience in `ACCESS_AUD`; never reuse one policy as the other.
7. Set `GUEST_IDENTITY_PEPPER` through `wrangler secret put`; never place it in a file or command history.

## Review Commands

```bash
cd /media/taran/LargeStorage/taran/challanse-website
export npm_config_cache=/media/taran/LargeStorage/.cache/npm-challanse
npm ci
npm run check
npm test
npm run build
npm run build:landing
npm run test:landing
```

Apply migration `0012_guest_workspaces.sql` to a non-production D1 database, then run the synthetic acceptance suite with deterministic AI mocks. Verify immediate deletion and the hourly retention trigger.

## Staging Acceptance

- Fifty accepted uploads produce fifty unique durable receipts.
- Completion acknowledges after R2 and D1 writes and before AI completion.
- Malformed or unavailable AI output becomes **Needs correction**.
- Cross-identity reads, mutations, exports and deletion return denial.
- Expired workspaces remove R2 objects and private D1 data.
- Chromium and Firefox pass at 390×844, 768×1024 and 1440×900.

## Production Gate

Deployment requires explicit human approval after green CI, zero unresolved critical/high findings, valid Access configuration, current free-plan verification and staging evidence. Do not enable Android guest access.
