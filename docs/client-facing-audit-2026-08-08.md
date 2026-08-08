# ChallanSe Client-Facing Audit

Date: 2026-08-08

## Scope and Boundary

The public landing page may demonstrate the workflow with fictional data. It must not accept or store real invoices until passwordless guest verification, consent, private storage, expiry, deletion, abuse controls, and tenant isolation are deployed and independently tested.

The existing reviewer and Android workflows remain private and local-first. AWS deployment remains frozen.

## Button-to-Action Matrix

| Surface | Control | Expected action | Supporting code or API | Current result |
|---|---|---|---|---|
| Public desktop nav | Request Pilot | Open the preselected ChallanSe contact route | `assets/nav.html`; build transform in `scripts/landing-build-utils.mjs` | Fixed in branch; live deployment is stale |
| Public mobile nav | Menu | Open/close drawer; Escape closes and restores focus | `assets/js/main.js` | Fixed in branch; covered by Playwright |
| Public mobile nav | Request Pilot | Open the preselected ChallanSe contact route | Built navigation asset | Fixed in branch; live deployment is stale |
| Public hero | Try sample invoice | Open fictional sample chooser | `index.html`; `assets/js/challanse.js` | Implemented; browser-only and storage-free |
| Public hero | Process my invoice | Continue to private-access contact route | Real anchor to Constrovet contact page | Implemented; real upload intentionally unavailable |
| Public workflow | Capture, Save, Send, Check | Display exactly one corresponding panel | `assets/js/challanse.js` | Implemented; click and keyboard tests present |
| Public sample | Sample choices | Display deterministic fictional extraction result | `assets/js/challanse.js` | Implemented; no network request |
| Public sample | Try another | Return to sample chooser | `assets/js/challanse.js` | Implemented |
| Public sample | Process my invoice | Continue to private-access contact route | Real anchor | Implemented |
| Public footer | Privacy | Open Constrovet privacy page | Real anchor | Implemented |
| Public footer | Contact | Open preselected ChallanSe contact route | Real anchor | Implemented |
| Reviewer login | Sign in | Validate individual password and TOTP or recovery code | `POST /login` | Implemented locally; requires running encrypted stack |
| Reviewer Inbox | Create invoice | Choose image upload or manual entry | Reviewer React state | Implemented locally |
| Reviewer Inbox | Upload invoice | Validate metadata and submit private image | `POST /v1/reviewer/invoices/image` | Implemented locally; authenticated |
| Reviewer Inbox | Enter details | Create manual invoice | `POST /v1/reviewer/invoices/manual` | Implemented locally; authenticated |
| Reviewer receipt | Verify or reject | Optimistic update and immutable audit event | `PATCH /v1/reviewer/receipts/{id}` | Implemented locally |
| Reviewer Delta | Import Tally CSV | Validate and import purchase orders | `POST /v1/reviewer/po-imports` | Implemented locally |
| Reviewer Delta | View reconciliation | Compare verified receipts with imported POs | `GET /v1/reviewer/reconciliation` | Implemented locally |
| Reviewer | Exit | Invalidate session | `POST /logout` | Implemented locally |
| Operator | Enrol/revoke device | Create expiring code or revoke device | Admin APIs | Implemented locally and role-protected |
| Android | Enrol | Exchange one-time QR for revocable device credential | `POST /v1/devices/enroll` | Implemented; no connected-device proof in this audit |
| Android | Save capture | Confirm encrypted local write before dismissal | OP-SQLite/SQLCipher receipt store | Implemented; hardware performance remains unverified |
| Android | Resume upload | Continue from server-confirmed 256 KB part | Upload session APIs and WorkManager | Implemented; hardware interruption test remains required |

## Verified Failures and Blockers

1. The live site serves asset marker `546518d`, not the current repair branch.
2. Live navigation still contains inert asynchronously injected `data-pilot-request` buttons.
3. PR 18 fails `validate` and `security (npm-audit)` because the React Native Metro toolchain resolves a vulnerable `image-size` parser. Android was cancelled after the failed gate.
4. No public verified-guest service exists. Therefore real invoice upload is correctly absent from the public page.
5. No Android device was connected during this audit. Camera, haptics, SQLCipher-at-rest, interruption recovery, and write latency are not current device evidence.

## Proposed Client UX

1. **Try sample invoice**: choose one fictional sample and see a deterministic result without registration, upload, storage, or network processing.
2. **Process my invoice**: request private access. Do not imply that a real document can be uploaded anonymously.
3. **Verified guest**: after a separately approved implementation, accept terms, verify email, create an expiring isolated workspace, upload one invoice, review the result, then download or delete it.
4. **Registered client**: enrol devices, capture offline, synchronize resumably, review, reconcile, and export audit evidence.

## Minimal Deployment Plan

1. Keep the public static landing independent from private APIs.
2. Resolve or formally isolate the React Native build-tool vulnerability without force-downgrading React Native.
3. Require landing build, Chromium/Firefox Playwright, accessibility, CodeQL, and live smoke checks.
4. Merge only the focused public repair after green required checks.
5. Deploy the informational landing through GitHub Pages and verify its commit marker.
6. Design and threat-model verified guest access before exposing any real-data endpoint.
7. Keep reviewer/API local until the remote-access phase has explicit approval and evidence.

## Evidence Limitations

- The public browser flow can be fully automated.
- Reviewer and API behavior requires the encrypted local stack.
- Android readiness requires a real enrolled device and cannot be inferred from CI.
- A contact request is not invoice processing and must not be represented as such.
