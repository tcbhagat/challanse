# ChallanSe Repository — Architectural Survey Report

**Date:** 2026-07-31<br>
**Repository:** `/home/taran/challanse-website`<br>
**Survey Type:** Full-stack architecture, CI/CD, infrastructure, and quality review

> **Corrections applied 2026-07-31:** This revision fixes previously stale claims
> (governance files reported as missing although they exist, CI migration
> validation reported as incomplete although it covers all 12 migrations, stale
> `ci-pages.yml` line numbers, and branch-protection wording that contradicted
> the corrected `.github/BRANCH-PROTECTION-SETTINGS.md`). It also adds an
> explicit **Architecture states** section (Section 2) so the document does not
> describe the Edge Worker as the complete production backend.

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
├── CNAME                       # GitHub Pages custom domain (challanse.constrovet.com)
├── index.html                  # Public landing page (ChallanSe) — informational only
├── package.json                # Root monorepo package
├── package-lock.json
├── playwright.config.ts
├── README.md
├── robots.txt
├── sitemap.xml
├── .agents/
├── .codex/
├── .github/
│   ├── CODEOWNERS              # Present — review routing by path
│   ├── dependabot.yml          # Present — automated dependency updates
│   ├── BRANCH-PROTECTION-SETTINGS.md   # Corrected protection policy (terraform-check required)
│   └── workflows/
│       ├── ci-pages.yml        # Primary CI/CD workflow
│       └── codeql-analysis.yml # CodeQL security analysis
├── apps/
│   ├── edge/                   # Cloudflare Workers API — EXPERIMENTAL (not production)
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
│   │   ├── challanse.css       # Landing page styles
│   │   └── style.css           # Constrovet shared styles
│   ├── fonts/
│   └── js/
│       ├── challanse.js        # Landing page JS (tabs, pilot request dialog, Turnstile)
│       ├── main.js             # Shared nav/footer injection
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
│       │   └── enrichment/     # Reusable enrichment module
│       ├── production/
│       │   ├── .terraform.lock.hcl
│       │   └── main.tf
│       └── staging/
│           ├── .terraform.lock.hcl
│           └── main.tf
├── packages/
│   └── contracts/              # Shared TypeScript types (ReceiptListItem, etc.)
├── plans/
│   ├── architectural-survey.md # This document
│   ├── governance-settings.md
│   └── pages-restoration.md
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

## 2. Architecture States

Three distinct architecture states exist in this repository. They must not be
confused with one another:

### 2.1 Current supported runtime — local synthetic pilot

- **Components:** PostgreSQL, local object storage (LocalStack), Tesseract OCR,
  and the local `qwen2.5:7b` model.
- This is the **only currently supported and runnable stack**. All services run
  locally for development and testing; no remote endpoint is operational
  outside of local development.
- The public website is informational only — no real invoices are processed
  through it.

### 2.2 Planned funded production — AWS architecture (frozen, unprovisioned)

- The AWS architecture described in `infra/terraform/` and `docs/` remains a
  **planned design**.
- It is frozen (`AWS_DEPLOYMENT_FROZEN=true`) and **unprovisioned**: no AWS
  resources are deployed and none are being deployed.
- `terraform-plan` and `deploy-enrichment` remain gated by the freeze.

### 2.3 Experimental Cloudflare-native backend (incomplete, NOT deployable)

- The Edge Worker (`apps/edge/`) is **experimental**. Queue consumers and
  architecture approval are **pending**.
- It is **NOT deployable** and **NOT the complete production backend**.
- The `deploy-cloudflare` job is gated behind `PILOT_DEPLOY_ENABLED == 'true'`
  (currently `false`) and the Cloudflare queue-consumer deployment steps are
  placeholders. External-provider integrations (including xAI/Grok and
  agentmemory) are disabled — the corresponding secrets/configuration are
  empty and the adapters are not enabled.

---

## 3. Frontend Analysis

### 3.1 Public Landing Page (`index.html`)

| Aspect | Path | Status |
|--------|------|--------|
| HTML structure | [`index.html`](index.html) | Valid HTML5, semantic landmarks |
| CSP header | [`index.html:61`](index.html:61) | Present (self-only, Turnstile CDN, API endpoint) |
| SEO meta | [`index.html:6-16`](index.html:6) | Complete (OG, Twitter, canonical, JSON-LD schema) |
| Interactivity | [`assets/js/challanse.js`](assets/js/challanse.js) | Workflow tabs, pilot request dialog with Turnstile, POST to `/v1/pilot-requests` |

**Observation:** The landing page contains **no invoice upload section** and no
`<section class="cs-upload">`. The pilot request dialog collects business
contact details only. Prior issues regarding a `<div role="button">` upload
dropzone, an empty `<img src="">` preview, and a simulated invoice upload were
**resolved** — none of those elements exist in the current markup or script.

### 3.2 React Native Mobile App (`apps/mobile/`)

| Aspect | Path | Status |
|--------|------|--------|
| Entry point | [`apps/mobile/index.js`](apps/mobile/index.js) | Registers main App + headless sync task |
| Package | [`apps/mobile/package.json`](apps/mobile/package.json) | React Native 0.86.0, 12 dependencies |
| Build variants | [`apps/mobile/package.json`](apps/mobile/package.json) | `assembleLocalPilot` custom build flavor |
| Camera | `react-native-vision-camera` ^5.1.0 | Present |
| SQLCipher | `@op-engineering/op-sqlite` ^17.1.2 | SQLCipher enabled for offline storage |
| Keychain | `react-native-keychain` ^10.0.0 | Credential storage |
| Netinfo | `@react-native-community/netinfo` ^12.0.1 | Connectivity detection |

### 3.3 React Reviewer SPA (`apps/reviewer/`)

| Aspect | Path | Status |
|--------|------|--------|
| Entry | [`apps/reviewer/src/App.tsx`](apps/reviewer/src/App.tsx) | Full SPA with inbox, delta view, admin panel |
| Build | [`apps/reviewer/package.json`](apps/reviewer/package.json) | Vite, React 19, TypeScript |
| Testing | [`apps/reviewer/package.json`](apps/reviewer/package.json) | Vitest, jsdom |

**Observation:** The material description preview uses the semantic `<output>`
element (`<output className="field-preview">`). The prior issue (preview label
on a plain `<span>`) was **resolved**.

---

## 4. Python Backend Analysis (`services/enrichment/`)

### 4.1 Structure

| Component | Path | Description |
|-----------|------|-------------|
| FastAPI app | [`services/enrichment/app/main.py`](services/enrichment/app/main.py) | 30+ endpoints |
| Workflow engine | [`services/enrichment/app/workflow.py`](services/enrichment/app/workflow.py) | Receipt enrichment pipeline (Image → OCR) |
| Docker image | [`services/enrichment/Dockerfile`](services/enrichment/Dockerfile) | Python 3.12-slim, uvicorn |
| Dependencies | [`services/enrichment/requirements.txt`](services/enrichment/requirements.txt) | FastAPI, boto3, psycopg, Pillow, cryptography, OpenTelemetry |
| Test deps | [`services/enrichment/requirements-dev.txt`](services/enrichment/requirements-dev.txt) | pytest |

### 4.2 Migrations (0001–0012)

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

### 4.3 Review/Invoice Upload Workflow

- **Manual invoice creation:** `POST /v1/reviewer/invoices` — creates a receipt
  with `source=MANUAL`, no image required.
- **Image invoice upload:** `POST /v1/reviewer/invoice-images` — accepts image
  binary with metadata headers, creates receipt with `source=IMAGE_UPLOAD`.
- **Receipt enrichment pipeline:** `workflow.py` `_process_receipt_event()` →
  fetch image → verify WebP → extract GPS → OCR.

**Note (corrected):** CI migration validation is **not** incomplete. The
`enrichment` job in `ci-pages.yml` runs
`bash ../../scripts/validate-migrations.sh --check-only`, and
[`scripts/validate-migrations.sh`](scripts/validate-migrations.sh) validates
**all 12** migration files (0001–0012).

---

## 5. CI/CD Analysis (`.github/workflows/`)

Two workflow files exist:

- `.github/workflows/ci-pages.yml` — primary CI/CD pipeline.
- `.github/workflows/codeql-analysis.yml` — CodeQL security analysis for
  JavaScript/TypeScript and Python.

The `ci-pages.yml` jobs (line references intentionally omitted — job names are
the stable identifier):

| Job | Purpose | Gates |
|-----|---------|-------|
| `validate` | Static checks + build | `npm ci`, `npm run check`, `npm test`, `npm audit`, `npm run build`, edge integration, production-config, Lighthouse |
| `android` | Android build | TypeScript check, Jest tests, Gradle assembleDebug |
| `enrichment` | Python tests | Pytest, migration file validation (**all 12 migrations** via `validate-migrations.sh --check-only`) |
| `security` | Security scanning | `npm audit`, `pip-audit`, `bandit`, `gitleaks`, config-check, Trivy on Terraform (matrix, `fail-fast: false`) |
| `terraform-plan` | TF plan validation | **Gated behind `AWS_DEPLOYMENT_FROZEN != 'true'`** — skipped while the freeze is active; not a required check |
| `integration` | Integration tests | Postgres + LocalStack, pytest integration markers — **no `if:` gate**, always runs |
| `terraform-check` | TF validation | `terraform fmt`, `init`, `validate` on staging and production — **no `if:` gate**; the required check instead of `terraform-plan` |
| `deploy-enrichment` | AWS ECS deploy (deprecated) | **Gated on:** no PR, `main`, `AWS_DEPLOYMENT_FROZEN != 'true'`, `PILOT_DEPLOY_ENABLED == 'true'`, `AWS_ENRICHMENT_BOOTSTRAPPED == 'true'` |
| `deploy-landing` | GitHub Pages informational landing | **Runs on:** no PR, `main` push — decoupled from `PILOT_DEPLOY_ENABLED`; builds the static landing (`npm run build:landing`), copies `CNAME` into `dist/landing/`, configures Pages, uploads `dist/landing`, deploys Pages. No application/API secrets are used. |
| `deploy-cloudflare` | Cloudflare Workers + D1 + Queues (experimental) | **Gated on:** no PR, `main`, `PILOT_DEPLOY_ENABLED == 'true'`. Queue-consumer deployment steps are placeholders. |
| `release-android` | Google Play AAB | **Gated on:** no PR, `main`, `PILOT_DEPLOY_ENABLED == 'true'`, `PLAY_PUBLISH_ENABLED == 'true'` |

### Key Security Checks

| Check | Tool | Job |
|-------|------|-----|
| npm audit | `npm audit --omit=dev --audit-level=high` | `validate`, `security (npm-audit)` |
| Python vulnerability scan | `pip-audit` | `security (pip-audit)` |
| Python SAST | `bandit -q -r services/enrichment/app` | `security (bandit)` |
| Git history secrets | `gitleaks` (Docker, v8.18.2) | `security (secret-scanning)` |
| Terraform scanning | `trivy config` (Docker, pinned SHA) | `security (tfscan)` |
| Container vulnerability (deploy) | `trivy image` | `deploy-enrichment` |

### Deployment Gating Variables

| Variable | Purpose | Used In |
|----------|---------|---------|
| `AWS_DEPLOYMENT_FROZEN` | Blocks all AWS paths if `'true'` | `terraform-plan`, `deploy-enrichment` |
| `PILOT_DEPLOY_ENABLED` | Enables deployment jobs if `'true'` | `deploy-enrichment`, `deploy-cloudflare`, `release-android` (NOT `deploy-landing`) |
| `AWS_ENRICHMENT_BOOTSTRAPPED` | Enables AWS enrichment deploy | `deploy-enrichment` |
| `PLAY_PUBLISH_ENABLED` | Enables Google Play publishing | `release-android` |

### Issues Found

**Issue 1: Cloudflare-native backend is experimental and incomplete**<br>
The Edge Worker exists in `apps/edge/`, but queue consumers are not built and
architecture approval is pending. The `deploy-cloudflare` job is gated behind
`PILOT_DEPLOY_ENABLED` and must remain disabled. The Edge Worker is **not** the
complete production backend.

**Issue 2: Frozen AWS jobs are intentionally skipped**<br>
While `AWS_DEPLOYMENT_FROZEN=true`, `terraform-plan` and `deploy-enrichment`
are skipped by design per `docs/aws-deployment-freeze.md`. This is intentional;
`terraform-check` always runs as the required validation.

---

## 6. Terraform Analysis (`infra/terraform/`)

### 6.1 Structure

```
infra/terraform/
├── backend.hcl.example
├── modules/
│   └── enrichment/
│       ├── main.tf           # VPC, RDS, ECS, S3, SQS, KMS, ALB, backups
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

### 6.2 Key Architecture (planned, frozen)

- **Region:** `ap-south-1` (Mumbai)
- **VPC:** /16 CIDR, 2 AZs, public + private subnets, NAT gateways
- **RDS:** PostgreSQL 17.5, encrypted, automated backups, PITR
- **ECS:** Fargate tasks (API, Worker, Migration, Cloudflare Tunnel)
- **S3:** Receipt image bucket with KMS encryption, versioning, lifecycle policies
- **SQS:** Receipt queue with DLQ
- **ALB:** Internal-facing HTTPS, TLS 1.3-1.2
- **KMS:** Single key for all data encryption (RDS, S3, SQS, Secrets Manager)
- **Secrets Manager:** Runtime config + database connection strings

> **Note:** This AWS architecture is **planned and frozen** (State 2 above). No
> AWS resources are deployed or being deployed.

### 6.3 Staging vs Production Differences

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

**Issue 3: `PILOT_DEPLOY_ENABLED` remains the gate for AWS/Cloudflare deploys**<br>
`PILOT_DEPLOY_ENABLED` gates `deploy-enrichment`, `deploy-cloudflare`, and
`release-android`. It is managed by a guarded CLI that sets it to `true`
temporarily and restores it to `false` on completion/failure. The informational
GitHub Pages landing (`deploy-landing`) is the exception — it no longer depends
on this variable.

---

## 7. npm Dependencies & Audit State

### 7.1 Package Structure

- **Root:** Monorepo with workspaces `apps/*` and `packages/*`
- **Dev dependencies:** `@axe-core/playwright`, `@playwright/test`,
  `html-validate`, `lighthouse`, `react`, `react-dom`
- **Workspaces:** `@challanse/mobile`, `@challanse/reviewer`, `@challanse/edge`,
  `@challanse/contracts`

### 7.2 brace-expansion

`brace-expansion` appears as a transitive dependency in `package-lock.json`
via eslint/glob tooling. Older v1.1.x releases carried a known ReDoS
advisory. The root `package.json` pins an `overrides` entry
(`"brace-expansion": "5.0.9"`), which resolves all transitive occurrences to
the patched major version. CI runs `npm audit --omit=dev --audit-level=high`
and would fail on any HIGH-or-above vulnerability.

---

## 8. Repository Governance

### 8.1 Files Found

| File | Path | Status |
|------|------|--------|
| `CODEOWNERS` | [`.github/CODEOWNERS`](.github/CODEOWNERS) | **Present** |
| `dependabot.yml` | [`.github/dependabot.yml`](.github/dependabot.yml) | **Present** |
| `codeql-analysis.yml` | [`.github/workflows/codeql-analysis.yml`](.github/workflows/codeql-analysis.yml) | **Present** |
| `renovate.json` | — | Not found (not used) |
| Branch protection | [`.github/BRANCH-PROTECTION-SETTINGS.md`](.github/BRANCH-PROTECTION-SETTINGS.md) | Corrected policy — see below |
| `.gitleaks.toml` | [`.gitleaks.toml`](.gitleaks.toml) | Extends default rules only |
| `.gitleaksignore` | [`.gitleaksignore`](.gitleaksignore) | Present (empty/in use) |
| `README.md` | [`README.md`](README.md) | Extensive, documents all systems |
| `quality/gates.json` | [`quality/gates.json`](quality/gates.json) | Quality gates definition |
| `🛡️ AGENTS.md` | [`🛡️ AGENTS.md`](🛡️%20AGENTS.md) | Agent instructions |

### 8.2 Observations

- **Dependabot is configured** (`.github/dependabot.yml`) for npm, pip, and
  GitHub Actions ecosystems. Renovate is not used.
- **CODEOWNERS is present** (`.github/CODEOWNERS`) — automatic review routing
  by path (CI/CD, infrastructure, enrichment, reviewer, edge, deploy, scripts).
- **CodeQL is configured** via `.github/workflows/codeql-analysis.yml` for
  JavaScript/TypeScript and Python.
- **`.gitleaks.toml` uses only default rules** — no custom patterns.
- **Quality gates** defined in JSON: blocking at CRITICAL/HIGH, covering OWASP
  ASVS, API Top 10, MASVS L1, CIS Docker, WCAG 2.2 AA, and recovery controls.
- **Branch protection** is documented in
  [`.github/BRANCH-PROTECTION-SETTINGS.md`](.github/BRANCH-PROTECTION-SETTINGS.md).
  Per the corrected policy, the required status checks are `validate`,
  `android`, `enrichment`, `security` (six matrix variants), `integration`, and
  **`terraform-check`**. **`terraform-plan` is NOT a required check** — it is
  gated behind `AWS_DEPLOYMENT_FROZEN` and does not run during the freeze.

---

## 9. Issues Summary

| # | Severity | Area | Description |
|---|----------|------|-------------|
| 1 | **Info** | Cloudflare-native backend | Edge Worker (`apps/edge/`) is experimental and incomplete — queue consumers and architecture approval pending. Not the production backend. |
| 2 | **Info** | CI/CD | `terraform-plan` and `deploy-enrichment` are skipped while `AWS_DEPLOYMENT_FROZEN=true` — intentional. `terraform-check` is the always-running validation. |
| 3 | **Info** | CI/CD | `deploy-cloudflare` (and `deploy-enrichment`, `release-android`) remain gated behind `PILOT_DEPLOY_ENABLED == 'true'` — currently `false`. |

Previously reported issues — non-semantic upload `<div>`, empty `<img src="">`,
simulated invoice upload, `<span>` preview label, incomplete CI migration
validation, missing Dependabot, and missing CODEOWNERS — are **resolved**.

---

## 10. Current State Summary

### Working

- ✅ Landing page build: `npm run build:landing` produces `dist/landing/`
- ✅ HTML validation: `html-validate` runs clean
- ✅ Lighthouse CI: 3-pass median gate on performance, a11y, best practices, SEO
- ✅ React Native mobile: TypeScript checks, Jest tests, Gradle builds
- ✅ Reviewer SPA: TypeScript builds, Vite bundles, Vitest tests
- ✅ Python enrichment: pytest runs unit + integration tests
- ✅ All 12 PostgreSQL migrations exist and are validated by CI
  (`validate-migrations.sh --check-only`)
- ✅ Playwright browser tests with visual snapshots
- ✅ Terraform modules validate with `terraform validate` (`terraform-check`)
- ✅ Security scanning (Bandit, gitleaks, pip-audit, Trivy, npm audit)
- ✅ Dependabot, CODEOWNERS, and CodeQL are configured

### Known Issues

- ❌ Cloudflare-native backend is experimental and incomplete (queue consumers
  and architecture approval pending); it is not the production backend
- ❌ AWS architecture is frozen and unprovisioned — no resources deployed

### Deployment Status

- **AWS deployment is FROZEN** (`AWS_DEPLOYMENT_FROZEN=true`) per
  `docs/aws-deployment-freeze.md`; no AWS resources are deployed or being
  deployed (State 2).
- **Local synthetic pilot** (PostgreSQL, local object storage, Tesseract OCR,
  `qwen2.5:7b`) is the **only currently supported and runnable stack**
  (State 1).
- **GitHub Pages landing** (`deploy-landing`) runs on protected `main` pushes
  and publishes the **informational** static landing only. It does not require
  `PILOT_DEPLOY_ENABLED` and uses no application/API secrets.
- **Cloudflare Workers** (`deploy-cloudflare`) remain gated behind
  `PILOT_DEPLOY_ENABLED == 'true'` and are experimental (State 3); the Edge
  Worker is not the complete production backend.
- **Pilot deployment** of AWS/Cloudflare requires `PILOT_DEPLOY_ENABLED=true`
  (managed by guarded CLI); currently `false`.

---

## 11. Action Items for Code Mode

### Fix 1: Complete the Cloudflare-native backend or remove it from CI
**File:** `apps/edge/`, `ci-pages.yml`<br>
**Action:** Finish queue consumers and obtain architecture approval before any
production use. Until then, keep `deploy-cloudflare` gated behind
`PILOT_DEPLOY_ENABLED` and treat the Edge Worker as experimental only.

### Fix 2: Keep deployment freeze gates in place
**File:** `ci-pages.yml`<br>
**Action:** `terraform-plan` and `deploy-enrichment` must remain gated behind
`AWS_DEPLOYMENT_FROZEN != 'true'`; `deploy-cloudflare` and `release-android`
must remain gated behind `PILOT_DEPLOY_ENABLED == 'true'` (plus
`PLAY_PUBLISH_ENABLED` for Android).

### Resolved (no action needed)

The upload dropzone, empty `<img src="">`, simulated upload, `<span>` preview
label, CI migration validation coverage, Dependabot, and CODEOWNERS action
items from earlier revisions are **all resolved** in the current codebase.
