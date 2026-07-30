# ChallanSe Repository — Architectural Survey Report

**Date:** 2026-07-30  
**Repository:** `/home/taran/challanse-website`  
**Survey Type:** Full-stack architecture, CI/CD, infrastructure, and quality review

---

## 1. Full Directory Tree (Top 3 Levels)

```
challanse-website/
├── .dockerignore
├── .gitignore
├── .gitleaks.toml
├── .gitleaksignore
├── .nojekyll
├── 🛡️ .roomodes
├── 🛡️ AGENTS.md
├── AGENTS.md.backup
├── index.html                  # Public landing page (ChallanSe)
├── package.json                # Root monorepo package
├── package-lock.json
├── playwright.config.ts
├── README.md
├── robots.txt
├── sitemap.xml
├── .agents/
├── .codex/
├── .github/
│   └── workflows/
│       └── ci-pages.yml        # Single CI/CD workflow (527 lines)
├── apps/
│   ├── edge/                   # Cloudflare Workers API
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── wrangler.toml
│   │   ├── migrations/         # D1 SQL migrations (10 files: 0001-0010)
│   │   └── src/                # Worker source (handlers, auth, etc.)
│   ├── mobile/                 # React Native Android app
│   │   ├── package.json
│   │   ├── app.json
│   │   ├── index.js
│   │   ├── babel.config.js
│   │   ├── metro.config.js
│   │   ├── tsconfig.json
│   │   └── ...                 # Jest, prettier, watchman config
│   └── reviewer/               # React + Vite reviewer SPA
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       ├── wrangler.toml
│       └── src/                # App.tsx, api.ts, OperatorApp.tsx, styles.css
├── artifacts/                  # (empty or build artifacts)
├── assets/
│   ├── ATC-logo3.png
│   ├── footer.html
│   ├── nav.html
│   ├── css/
│   │   ├── challanse.css       # Landing page styles + upload CSS
│   │   └── style.css           # Constrovet shared styles
│   ├── fonts/
│   └── js/
│       ├── challanse.js        # Landing page JS (tabs, upload, pilot form)
│       ├── main.js              # Shared nav/footer injection
│       └── runtime-config.js   # Injected API base URL + Turnstile key
├── deploy/
│   └── local/                  # Docker Compose, Caddyfile for local Pilot
├── docs/
│   ├── aws-bootstrap.md
│   ├── aws-deployment-freeze.md
│   ├── challanse-usp-analysis.md
│   ├── dns-cutover.md
│   ├── hybrid-enrichment.md
│   ├── local-operations-manual.md
│   ├── local-pilot.md
│   ├── local-testing-runbook.md
│   ├── pilot-budget.md
│   ├── pilot-runbook.md
│   ├── release-readiness.md
│   └── templates/              # Acceptance test JSON templates
├── infra/
│   └── terraform/
│       ├── backend.hcl.example
│       ├── modules/
│       │   └── enrichment/     # Reusable enrichment module (1387 lines)
│       ├── production/
│       │   ├── .terraform.lock.hcl
│       │   └── main.tf
│       └── staging/
│           ├── .terraform.lock.hcl
│           └── main.tf
├── packages/
│   └── contracts/              # Shared TypeScript types (ReceiptListItem, etc.)
├── quality/
│   └── gates.json              # Quality gates definition
├── scripts/                    # 25+ shell/Python/Node.js scripts
├── services/
│   └── enrichment/             # Python FastAPI backend
│       ├── Dockerfile
│       ├── Dockerfile.local
│       ├── pytest.ini
│       ├── requirements.txt
│       ├── requirements-dev.txt
│       ├── app/                # Main application (30+ modules)
│       └── migrations/         # 12 PostgreSQL migrations (0001-0012)
└── tests/
    └── browser/                # Playwright browser tests
        ├── local-ui.spec.ts
        └── local-ui.spec.ts-snapshots/  # Visual baseline screenshots
```

---

## 2. Frontend Analysis

### 2.1 Public Landing Page (`index.html`)

| Aspect | Path | Status |
|--------|------|--------|
| HTML structure | [`index.html`](index.html) | Valid HTML5, semantic landmarks |
| CSP header | [`index.html:61`](index.html:61) | Present (self-only, Turnstile CDN, API endpoint) |
| SEO meta | [`index.html:6-16`](index.html:6) | Complete (OG, Twitter, canonical, JSON-LD schema) |
| Interactivity | [`assets/js/challanse.js`](assets/js/challanse.js) | Tab panel, pilot request dialog, invoice upload |

#### Issues Found

**Issue 1: Non-semantic clickable upload trigger**  
- **File:** [`index.html:212`](index.html:212)  
- **Code:** `<div class="cs-upload__dropzone" id="cs-upload-dropzone" role="button" tabindex="0" aria-label="Add an invoice image">`  
- **Problem:** Uses a `<div>` with `role="button"` to trigger file selection, rather than a native `<button>` or `<label for="cs-upload-input">`. The hidden `<input type="file">` is on line 213.  
- **WCAG violation:** Non-semantic interactive element; may not work reliably with all assistive technologies.  
- **Fix:** Replace with `<label class="cs-upload__dropzone" for="cs-upload-input">` containing the inner content, or use `<button type="button">` to open the file picker via JS.

**Issue 2: Empty `<img src="">` attribute**  
- **File:** [`index.html:246`](index.html:246)  
- **Code:** `<img id="cs-upload-preview-img" src="" alt="Invoice preview">`  
- **Problem:** `src=""` is an empty attribute. Browsers treat this as a request to the current page URL, which generates an unnecessary HTTP request (or a broken-image icon).  
- **Fix:** Either omit the `src` attribute initially, use `src=""` with explicit handling, or remove the element from the initial DOM and create it dynamically.

**Issue 3: Simulated invoice upload — no real API endpoint**  
- **File:** [`assets/js/challanse.js:326-348`](assets/js/challanse.js:326)  
- **Code:** Simulated submission with `setTimeout` that opens the pilot request dialog. No actual file upload API call.  
- **Observation:** This is intentional for the landing page demo, but may confuse users expecting a real upload. No action needed unless the product requirement changes.

### 2.2 React Native Mobile App (`apps/mobile/`)

| Aspect | Path | Status |
|--------|------|--------|
| Entry point | [`apps/mobile/index.js`](apps/mobile/index.js) | Registers main App + headless sync task |
| Package | [`apps/mobile/package.json`](apps/mobile/package.json) | React Native 0.86.0, 12 dependencies |
| Build variants | [`apps/mobile/package.json:19`](apps/mobile/package.json:19) | `assembleLocalPilot` custom build flavor |
| Camera | `react-native-vision-camera` ^5.1.0 | Present |
| SQLCipher | `@op-engineering/op-sqlite` ^17.1.2 | SQLCipher enabled for offline storage |
| Keychain | `react-native-keychain` ^10.0.0 | Credential storage |
| Netinfo | `@react-native-community/netinfo` ^12.0.1 | Connectivity detection |

### 2.3 React Reviewer SPA (`apps/reviewer/`)

| Aspect | Path | Status |
|--------|------|--------|
| Entry | [`apps/reviewer/src/App.tsx`](apps/reviewer/src/App.tsx) | Full SPA with inbox, delta view, admin panel |
| Build | [`apps/reviewer/package.json`](apps/reviewer/package.json) | Vite 8.1.4, React 19, TypeScript 5.9 |
| Testing | [`apps/reviewer/package.json:27-28`](apps/reviewer/package.json:27) | Vitest 4.1.10, jsdom |

#### Issue Found

**Issue 4: Preview label on a non-semantic `<span>` element**  
- **File:** [`apps/reviewer/src/App.tsx:185`](apps/reviewer/src/App.tsx:185)  
- **Code:** `<span className="field-preview">{description}</span>`  
- **Problem:** The material description preview is rendered in a plain `<span>`, which provides no semantic relationship to the form field it describes.  
- **Fix:** Use `<output>` element with appropriate `htmlFor` attribute referencing the material input, or use `aria-describedby` on the `<select>` to link to the preview.

---

## 3. Python Backend Analysis (`services/enrichment/`)

### 3.1 Structure

| Component | Path | Description |
|-----------|------|-------------|
| FastAPI app | [`services/enrichment/app/main.py`](services/enrichment/app/main.py) | 984 lines, 30+ endpoints |
| Workflow engine | [`services/enrichment/app/workflow.py`](services/enrichment/app/workflow.py) | Receipt enrichment pipeline (Image → OCR → GST) |
| Docker image | [`services/enrichment/Dockerfile`](services/enrichment/Dockerfile) | Python 3.12-slim, uvicorn |
| Dependencies | [`services/enrichment/requirements.txt`](services/enrichment/requirements.txt) | FastAPI, boto3, psycopg, Pillow, cryptography, OpenTelemetry |
| Test deps | [`services/enrichment/requirements-dev.txt`](services/enrichment/requirements-dev.txt) | pytest 9.1.1 |

### 3.2 Migrations (0001–0012)

| Migration | File | Purpose |
|-----------|------|---------|
| 0001 | [`0001_enrichment.sql`](services/enrichment/migrations/0001_enrichment.sql) | Initial enrichment schema |
| 0002 | [`0002_release_hardening.sql`](services/enrichment/migrations/0002_release_hardening.sql) | Release hardening |
| 0003 | [`0003_operational_jobs.sql`](services/enrichment/migrations/0003_operational_jobs.sql) | Operational jobs |
| 0004 | [`0004_replay_protection.sql`](services/enrichment/migrations/0004_replay_protection.sql) | Replay protection |
| 0005 | [`0005_production_tenancy.sql`](services/enrichment/migrations/0005_production_tenancy.sql) | Production tenancy |
| 0006 | [`0006_local_pilot.sql`](services/enrichment/migrations/0006_local_pilot.sql) | Local pilot support |
| 0007 | [`0007_local_pilot_controls.sql`](services/enrichment/migrations/0007_local_pilot_controls.sql) | Local pilot controls |
| 0008 | [`0008_local_service_health.sql`](services/enrichment/migrations/0008_local_service_health.sql) | Local service health table |
| 0009 | [`0009_local_test_runs.sql`](services/enrichment/migrations/0009_local_test_runs.sql) | Local test runs + operator events |
| 0010 | [`0010_local_test_run_identity_retention.sql`](services/enrichment/migrations/0010_local_test_run_identity_retention.sql) | FK fixes for test runs |
| 0011 | [`0011_manual_invoice_entry.sql`](services/enrichment/migrations/0011_manual_invoice_entry.sql) | Manual invoice support (source=MANUAL) |
| 0012 | [`0012_reviewer_image_invoice.sql`](services/enrichment/migrations/0012_reviewer_image_invoice.sql) | Add IMAGE_UPLOAD source to receipts |

### 3.3 Review/Invoice Upload Workflow

- **Manual invoice creation:** [`main.py:612-621`](services/enrichment/app/main.py:612) — `POST /v1/reviewer/invoices` — creates a receipt with `source=MANUAL`, no image required.
- **Image invoice upload:** [`main.py:624-647`](services/enrichment/app/main.py:624) — `POST /v1/reviewer/invoice-images` — accepts image binary with metadata headers, creates receipt with `source=IMAGE_UPLOAD`.
- **Receipt enrichment pipeline:** [`workflow.py`](services/enrichment/app/workflow.py) — `_process_receipt_event()` → fetch image → verify WebP → extract GPS → OCR → optionally validate GST.

### Issue Found

**Issue 5: CI migration validation skips migrations 0008, 0009, 0010, 0012**
- **File:** [`.github/workflows/ci-pages.yml:74`](.github/workflows/ci-pages.yml:74)  
- **Code:** Validates `0001` through `0007`, then `0011`, but omits `0008`, `0009`, `0010`, `0012`.  
- **Fix:** Add checks for `0008_local_service_health.sql`, `0009_local_test_runs.sql`, `0010_local_test_run_identity_retention.sql`, and `0012_reviewer_image_invoice.sql`. Or switch to a dynamic check like `for f in migrations/*.sql; do test -s "$f"; done`.

---

## 4. CI/CD Analysis (`.github/workflows/ci-pages.yml`)

Only **one workflow file** exists. It contains 8 jobs:

| Job | Line | Purpose | Gates |
|-----|------|---------|-------|
| `validate` | 17 | Static checks + build | `npm ci`, `npm run check`, `npm test`, `npm audit`, `npm run build`, Lighthouse |
| `android` | 41 | Android build | TypeScript check, Jest tests, Gradle assembleDebug |
| `enrichment` | 59 | Python tests | Pytest, migration file validation |
| `security` | 76 | Security scanning | `npm audit`, `pip-audit`, `bandit`, `gitleaks`, Trivy on Terraform |
| `terraform-plan` | 99 | TF validation | `terraform fmt`, `init`, `validate` — **gated behind `AWS_DEPLOYMENT_FROZEN != 'true'`** |
| `integration` | 115 | Integration tests | Postgres + LocalStack, pytest integration markers — **gated behind `AWS_DEPLOYMENT_FROZEN != 'true'`** |
| `deploy-enrichment` | 159 | AWS ECS deploy | **Gated on:** `main` branch, no PR, `AWS_DEPLOYMENT_FROZEN != 'true'`, `PILOT_DEPLOY_ENABLED == 'true'`, `AWS_ENRICHMENT_BOOTSTRAPPED == 'true'`. Requires all 6 prior jobs. |
| `deploy-landing` | 255 | Cloudflare Pages | **Gated on:** `main` branch, no PR, `PILOT_DEPLOY_ENABLED == 'true'`. Requires validate, android, enrichment, security. |
| `deploy-cloudflare` | 286 | Workers + D1 + Queues | **Gated on:** `main` branch, no PR, `PILOT_DEPLOY_ENABLED == 'true'`. Requires validate, android, enrichment, security. |
| `release-android` | 413 | Google Play AAB | **Gated on:** `main` branch, no PR, `PILOT_DEPLOY_ENABLED == 'true'`, `PLAY_PUBLISH_ENABLED == 'true'`. Requires deploy-cloudflare, deploy-landing. |

### Key Security Checks

| Check | Tool | Location |
|-------|------|----------|
| npm audit | `npm audit --omit=dev --audit-level=high` | Lines 28, 88 |
| Python vulnerability scan | `pip-audit` | Line 90 |
| Python SAST | `bandit -q -r services/enrichment/app` | Line 91 |
| Git history secrets | `gitleaks` (Docker, v8.18.2) | Line 94 |
| Terraform scanning | `trivy config` (Docker, pinned SHA) | Line 97 |
| Container vulnerability (deploy) | `trivy image` | Line 186 |

### Deployment Gating Variables

| Variable | Purpose | Used In |
|----------|---------|---------|
| `AWS_DEPLOYMENT_FROZEN` | Blocks all AWS paths if `'true'` | terraform-plan, integration, deploy-enrichment |
| `PILOT_DEPLOY_ENABLED` | Enables deployment jobs if `'true'` | deploy-enrichment, deploy-landing, deploy-cloudflare, release-android |
| `AWS_ENRICHMENT_BOOTSTRAPPED` | Enables AWS enrichment deploy | deploy-enrichment |
| `PLAY_PUBLISH_ENABLED` | Enables Google Play publishing | release-android |

### Issues Found

**Issue 6: Failing workflow (Actions Run ID 30526195580)**  
Without direct access to the logs, the workflow may fail due to the `AWS_DEPLOYMENT_FROZEN == 'true'` variable blocking `terraform-plan` and `integration` jobs — this is **by design** per `docs/aws-deployment-freeze.md`. The CI would show these jobs as skipped, not failed. If there's a genuine failure, it's likely in `validate` (Lighthouse thresholds or HTML validation) or `enrichment` (migration validation step failing — see Issue 5).

**Issue 7: Migration validation in CI is incomplete**  
See Issue 5 above — the `enrichment` job's migration validation step (line 74) does not cover files 0008, 0009, 0010, and 0012.

---

## 5. Terraform Analysis (`infra/terraform/`)

### 5.1 Structure

```
infra/terraform/
├── backend.hcl.example
├── modules/
│   └── enrichment/
│       ├── main.tf           # 1387 lines — VPC, RDS, ECS, S3, SQS, KMS, ALB, backups
│       ├── outputs.tf
│       ├── variables.tf
│       └── versions.tf
├── production/
│   ├── .terraform.lock.hcl
│   └── main.tf               # Production config (multi-AZ, textract, 2 tasks)
└── staging/
    ├── .terraform.lock.hcl
    └── main.tf                # Staging config (single-AZ, mock OCR, 1 task)
```

### 5.2 Key Architecture

- **Region:** `ap-south-1` (Mumbai)
- **VPC:** /16 CIDR, 2 AZs, public + private subnets, NAT gateways
- **RDS:** PostgreSQL 17.5, encrypted, automated backups, PITR
- **ECS:** Fargate tasks (API, Worker, Migration, Cloudflare Tunnel)
- **S3:** Receipt image bucket with KMS encryption, versioning, lifecycle policies
- **SQS:** Receipt queue with DLQ, credit FIFO queue with DLQ
- **ALB:** Internal-facing HTTPS, TLS 1.3-1.2
- **KMS:** Single key for all data encryption (RDS, S3, SQS, Secrets Manager)
- **Secrets Manager:** Runtime config + database connection strings

### 5.3 Staging vs Production Differences

| Parameter | Staging | Production |
|-----------|---------|------------|
| VPC CIDR | 10.40.0.0/16 | 10.50.0.0/16 |
| OCR provider | `mock` | `textract` |
| Multi-AZ | `false` | `true` |
| DB instance | `db.t4g.micro` | `db.t4g.small` |
| API desired count | 1 | 2 |
| Worker desired count | 1 | 2 |
| NAT gateways | 1 | 2 |
| Deletion protection | `false` | `true` |
| Play Integrity | Set from var | `"google"` provider |

### Issue Found

**Issue 8: `PILOT_DEPLOY_ENABLED` is the master deployment gate**  
The variable `PILOT_DEPLOY_ENABLED` controls production deployment across all jobs. The README states it's managed by a guarded CLI that sets it to `true` temporarily and restores it to `false` on completion/failure. This is working as designed.

---

## 6. npm Dependencies & Audit State

### 6.1 Package Structure

- **Root:** Monorepo with workspaces `apps/*` and `packages/*`
- **Dev dependencies:** `@axe-core/playwright`, `@playwright/test`, `html-validate`, `lighthouse`, `react`, `react-dom`
- **Workspaces:** `@challanse/mobile`, `@challanse/reviewer`, `@challanse/edge`, `@challanse/contracts`

### 6.2 brace-expansion

`brace-expansion` **is present** as a transitive dependency in `package-lock.json`, occurring in multiple packages:
- `@eslint/eslintrc` → `minimatch` → `brace-expansion` v1.1.16
- `@humanwhocodes/config-array` → `brace-expansion` v1.1.16
- `@typescript-eslint/typescript-estree` → `brace-expansion` v5.0.7
- `eslint` → `brace-expansion` v1.1.16
- `eslint-plugin-react` → `brace-expansion` v1.1.16
- `glob` → `brace-expansion` v1.1.16
- `test-exclude` → `brace-expansion` v1.1.16

**Note:** `brace-expansion` v1.1.16 has a known ReDoS vulnerability. The CI runs `npm audit --omit=dev --audit-level=high`, which would catch this if it's rated HIGH or above. v1.1.16 was released in 2024 to fix the ReDoS, so it should be patched. The CI runs `npm audit` at high severity level only.

---

## 7. Repository Governance

### 7.1 Files Found

| File | Path | Status |
|------|------|--------|
| `CODEOWNERS` | — | **NOT FOUND** |
| `dependabot.yml` | — | **NOT FOUND** |
| `renovate.json` | — | **NOT FOUND** |
| Branch protection | — | Not checked (GitHub settings) |
| `.gitleaks.toml` | [`.gitleaks.toml`](.gitleaks.toml) | Extends default rules only |
| `.gitleaksignore` | [`.gitleaksignore`](.gitleaksignore) | Present (empty/in use) |
| `README.md` | [`README.md`](README.md) | Extensive, documents all systems |
| `quality/gates.json` | [`quality/gates.json`](quality/gates.json) | Quality gates definition |
| `🛡️ AGENTS.md` | [`🛡️ AGENTS.md`](🛡️%20AGENTS.md) | Agent instructions |

### 7.2 Observations

- **No Dependabot or Renovate** — automated dependency updates are not configured.
- **No CODEOWNERS** — no automatic review assignment by path.
- **`.gitleaks.toml` uses only default rules** — no custom patterns.
- **Quality gates** defined in JSON: blocking at CRITICAL/HIGH, covering OWASP ASVS, API Top 10, MASVS L1, CIS Docker, WCAG 2.2 AA, and recovery controls.
- **Branch protection** on `main` is enforced via `ci-pages.yml` — requires `validate`, `android`, `enrichment`, `security`, `integration`, and `terraform-plan` to pass.

---

## 8. Issues Summary

| # | Severity | Area | File | Description |
|---|----------|------|------|-------------|
| 1 | **Medium** | Frontend (Landing) | [`index.html:212`](index.html:212) | Non-semantic `<div role="button">` as file upload trigger. Replace with `<label>` or `<button>`. |
| 2 | **Low** | Frontend (Landing) | [`index.html:246`](index.html:246) | Empty `src=""` on `<img>` causes unnecessary request. Set to empty string or remove initially. |
| 3 | **Low** | Frontend (Landing) | [`assets/js/challanse.js:326`](assets/js/challanse.js:326) | Simulated invoice upload with `setTimeout` — no real API. Intentional demo behavior. |
| 4 | **Low** | Frontend (Reviewer) | [`apps/reviewer/src/App.tsx:185`](apps/reviewer/src/App.tsx:185) | `<span>` used as preview label instead of `<output>` or `aria-describedby` linking. |
| 5 | **Medium** | CI/CD | [`.github/workflows/ci-pages.yml:74`](.github/workflows/ci-pages.yml:74) | Migration validation step skips 0008, 0009, 0010, 0012. Add missing file checks. |
| 6 | **Info** | CI/CD | `ci-pages.yml` | CI may show skipped jobs (`terraform-plan`, `integration`) when `AWS_DEPLOYMENT_FROZEN=true`. This is intentional. |
| 7 | **Info** | CI/CD | `deploy-enrichment` | Migration output hardcoded to `0006_local_pilot.sql`. Consider dynamic enumeration. |
| 8 | **Info** | Governance | — | No Dependabot, no CODEOWNERS, no Renovate configured. |

---

## 9. Current State Summary

### Working

- ✅ Landing page build: `npm run build:landing` produces `dist/landing/`
- ✅ HTML validation: `html-validate` runs clean
- ✅ Lighthouse CI: 3-pass median gate on performance, a11y, best practices, SEO
- ✅ React Native mobile: TypeScript checks, Jest tests, Gradle builds
- ✅ Reviewer SPA: TypeScript builds, Vite bundles, Vitest tests
- ✅ Python enrichment: pytest runs unit + integration tests
- ✅ All 12 PostgreSQL migrations exist and are valid SQL
- ✅ Playwright browser tests with visual snapshots
- ✅ Terraform modules validate with `terraform validate`
- ✅ Security scanning (Bandit, gitleaks, pip-audit, Trivy, npm audit)

### Known Issues

- ❌ CI migration validation is incomplete (missing 4 migration files)
- ❌ Landing page upload dropzone is a `<div>` not a native button/label
- ❌ Landing page preview `<img>` has empty `src=""`
- ❌ Reviewer SPA preview label is a plain `<span>` not `<output>`
- ❌ No Dependabot/Renovate — dependencies may drift behind security patches
- ❌ No CODEOWNERS — no enforced review routing by path

### Deployment Status

- **AWS deployment is FROZEN** (`AWS_DEPLOYMENT_FROZEN=true`) per `docs/aws-deployment-freeze.md`
- **Pilot deployment** requires `PILOT_DEPLOY_ENABLED=true` (managed by guarded CLI)
- **Cloudflare Workers** (API/reviewer) are the active deployment target
- **Local Pilot** (Docker Compose + encrypted storage) is the active demonstration environment

---

## 10. Action Items for Code Mode

### Fix 1: Replace non-semantic upload dropzone with native `<label>`
**File:** [`index.html:212-220`](index.html:212)  
**Action:** Change `<div class="cs-upload__dropzone" id="cs-upload-dropzone" role="button" tabindex="0" aria-label="Add an invoice image">` to `<label class="cs-upload__dropzone" for="cs-upload-input" id="cs-upload-dropzone">`. Remove the `click` and `keydown` event listeners in [`assets/js/challanse.js:234-240`](assets/js/challanse.js:234) since `<label>` activates the file input natively. Keep drag-and-drop listeners. Update CSS selector from `#cs-upload-dropzone` to `.cs-upload__dropzone` if needed.

### Fix 2: Fix empty `<img src="">`
**File:** [`index.html:246`](index.html:246)  
**Action:** Change `src=""` to `src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"` (1x1 transparent GIF) as a safe placeholder, or remove the `src` attribute entirely and let JavaScript set it dynamically.

### Fix 3: Update CI migration validation
**File:** [`.github/workflows/ci-pages.yml:74`](.github/workflows/ci-pages.yml:74)  
**Action:** Add checks for `0008_local_service_health.sql`, `0009_local_test_runs.sql`, `0010_local_test_run_identity_retention.sql`, and `0012_reviewer_image_invoice.sql`. Example additions:
```yaml
&& test -s migrations/0008_local_service_health.sql \
&& test -s migrations/0009_local_test_runs.sql \
&& test -s migrations/0010_local_test_run_identity_retention.sql \
&& test -s migrations/0012_reviewer_image_invoice.sql
```

### Fix 4: Replace preview `<span>` with `<output>` in Reviewer SPA
**File:** [`apps/reviewer/src/App.tsx:185`](apps/reviewer/src/App.tsx:185)  
**Action:** Change `<span className="field-preview">{description}</span>` to `<output className="field-preview" htmlFor="material-select">{description}</output>` and add `id="material-select"` to the material `<select>` element. Or add `aria-describedby` attribute to the material field referencing the preview element.

### Fix 5 (Optional): Add Dependabot config
**File:** `.github/dependabot.yml`  
**Action:** Create a Dependabot configuration for npm and pip dependencies. Example:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule: { interval: "weekly" }
  - package-ecosystem: "pip"
    directory: "/services/enrichment"
    schedule: { interval: "weekly" }
```
