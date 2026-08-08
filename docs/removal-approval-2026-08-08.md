# ChallanSe Removal Approval List

Nothing in this list has been deleted.

| Candidate | Why flagged | References | Proposed replacement | Migration impact | Rollback and tests |
|---|---|---|---|---|---|
| Orphaned public upload CSS | `cs-upload*` styles have no matching public markup or script and may imply an unsupported anonymous upload | `assets/css/challanse.css` | Remove after the verified-guest UI is designed, or reuse only inside that authenticated flow | No current rendered impact expected | Restore the CSS block; run landing visual and selector-coverage tests |
| Source-only pilot dialog in disabled builds | Static production builds remove it, while source markup adds complexity and Turnstile dependencies | `index.html`, `scripts/build-landing.mjs` | Keep only if the enabled pilot-request backend remains supported | Enabled builds would need a migration to the contact route | Revert source change; run enabled and disabled build tests |
| `data-pilot-request` source buttons | They rely on build transformation or runtime configuration and caused inert live navigation | `index.html`, `assets/nav.html`, `assets/js/challanse.js` | Prefer real anchors in public-safe source; retain delegated handling only for explicitly enabled forms | Changes enabled pilot-dialog behavior | Restore buttons; run injected-nav and enabled-form Playwright tests |
| Unauthenticated event routes | Comments state authentication is pending; they are unsafe for real client exposure | `apps/edge/src/index.ts` event route section | Require service identity, signatures, replay protection, and authorization before enabling | Enrichment producers must adopt signed requests | Feature flag rollback; integration tests for forged, replayed, and valid requests |
| Generated Playwright reports tracked in Git | Reports are reproducible artifacts and create stale evidence | `artifacts/landing-playwright*` | Store as CI artifacts outside source control | No product impact | Regenerate in CI; compare test results and screenshots |

Approval must identify exact rows. Removal must occur in a dedicated change with regression tests and a documented rollback.
