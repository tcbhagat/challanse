# Guest Service Implementation Evidence

Generated: 2026-08-09

Implementation commit: `b680390` (draft PR #18; not merged or deployed).

Working tree after this evidence amendment: clean and synchronized for human review.

## Scope

This draft-branch evidence records implementation, not production activation.

## Implemented

- Browser-only fictional sample flow.
- Access-authenticated temporary guest workspace UI and same-origin proxy.
- Additive D1 schema for consent, resumable upload, receipt projection, usage and security events.
- Private R2 parts and final image assembly with validation.
- Cloudflare Queue Workers AI processing with a 90% neuron ceiling and correction fallback.
- Confirmation, JSON/CSV export, immediate deletion and hourly 24-hour retention.
- Public CTA updated to **Process My Invoice**.
- Exact guest-origin CORS, Access JWT audience separation, CSRF protection and subject-bound authorization.
- Conservative free-tier circuit breakers: 50 accepted uploads globally, 3 per identity, 10 attempts per IP and a 9,000-neuron application ceiling per UTC day.
- Responsive guest acceptance tests at 1440x900, 768x1024 and 390x844.

## Validation Completed

- Root TypeScript and static checks: passed.
- Edge Vitest: 11 files, 37 tests passed.
- Reviewer Vitest: 4 files, 17 tests passed.
- Mobile Jest: 3 suites, 6 tests passed.
- Contracts Vitest: 1 file, 2 tests passed.
- Landing build tests: 4 tests passed.
- Guest Playwright: 12 tests passed across Chromium and Firefox at all three required viewports, including axe checks.
- Landing, edge and reviewer builds: passed.
- Edge and reviewer Wrangler dry-runs: passed.
- Production configuration and ShellCheck validation: passed.
- Local D1 migrations `0001` through `0012`: applied successfully to a local database.
- Repository whitespace validation: passed.
- Live repository variables verified: `AWS_DEPLOYMENT_FROZEN=true` and `PILOT_DEPLOY_ENABLED=false`.

## Failed or Unavailable Gates

- `npm audit --omit=dev --audit-level=high`: failed with nine high findings inherited through React Native Metro and `image-size@1.2.1`.
- The current latest `image-size@2.0.2` is also affected by the published advisories, so no safe compatible override was retained.
- Remote CodeQL and CI are rerunning against the complete-escaping patch; their results are not yet accepted evidence.
- No production Cloudflare deployment, Access OTP verification or live Workers AI request was performed.
- No 50-upload Cloudflare staging acceptance was performed because deployment remains disabled.

## Required Evidence Before Activation

- Clean CI and dependency/security scans.
- Local D1/R2/Queue integration suite and 50-upload staging acceptance.
- A successful rerun of remote CodeQL and dependency security checks.
- Access OTP application and audience validation.
- Production account confirmed as Workers Free with no paid fallback.
- Fifty-upload staging acceptance using deterministic AI mocks.
- Post-deployment private-data and control smoke tests.

## Unresolved Risks

- The repository currently has an upstream React Native Metro `image-size` advisory that remains an Android release blocker.
- Image validation verifies type signatures, declared dimensions and complete PNG/JPEG/WebP framing, but is not a full pixel-decoder proof in the Worker runtime.
- Android anonymous guest processing is intentionally absent.
- Production Cloudflare resources and Access policy have not been deployed or verified.
- Automated repository tooling created commits during implementation; human review of commit history is required.
- The compatibility page in the separate Constrovet repository has not been updated in this scoped change.

Production remains disabled. AWS remains frozen.
