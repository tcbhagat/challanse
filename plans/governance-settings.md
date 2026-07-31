# Repository Governance Settings

**Date**: 2026-07-30
**Repository**: `challanse-website`

---

## Overview

This document summarises the governance configuration for the ChallanSe repository. It covers what has been configured in-repo and what must be set through the GitHub UI.

---

## In-Repo Configuration (Already Created)

These files live in the repository and are active as soon as they are merged into `main`:

### 1. Dependabot (`/.github/dependabot.yml`)

Configures automated dependency update pull requests for three ecosystems:

| Ecosystem | Directory | Schedule | Labels |
|-----------|-----------|----------|--------|
| npm | `/` (root) | Weekly (production deps only) | `dependencies`, `security` |
| pip | `/services/enrichment` | Weekly | `dependencies`, `security` |
| GitHub Actions | `/` (workflows) | Weekly | `dependencies`, `ci` |

### 2. CODEOWNERS (`/.github/CODEOWNERS`)

Sets `@tcbhagat` as the default code owner for all files, with explicit ownership for:

- `/.github/workflows/` — CI/CD pipeline
- `/infra/` — Terraform infrastructure
- `/services/enrichment/` — Enrichment service (security-sensitive)
- `/apps/reviewer/` — Reviewer app (security-sensitive)
- `/apps/edge/` — Edge API worker
- `/deploy/` — Deployment configs
- `/scripts/` — Operational scripts

### 3. CodeQL (`/.github/workflows/codeql-analysis.yml`)

Runs CodeQL code scanning on push/PR to `main` and on a weekly schedule:

- **Languages**: JavaScript/TypeScript, Python (both with `build-mode: none`)
- **Query suite**: `security-and-quality`
- **Schedule**: Friday 04:41 UTC

---

## GitHub UI Configuration (Must Be Set Manually)

> **Status note (2026-07-30)**: The in-repo configuration files (Dependabot,
> CODEOWNERS, CodeQL workflow, this plan, and
> `.github/BRANCH-PROTECTION-SETTINGS.md`) are in place, but the **GitHub-side
> application of the stronger branch protection policy below is PENDING**.
> The live GitHub branch protection for `main` currently enforces **only** the
> checks `validate` and `android`. The full 11-check policy documented below is
> **NOT yet applied** and must not be assumed to be active. Applying it is an
> operational step (e.g. via `./scripts/go-live.sh harden-github`) that is out
> of scope for the CI-restoration task.

Navigate to **Repository → Settings** and configure the following:

### Branch Protection (`Settings → Branches → Add rule → main`)

> **Pending application** — see the status note above. This table describes the
> documented target policy, not the current live configuration.

| Setting | Value |
|---------|-------|
| Require pull request before merging | ☑ |
| Required approvals | `1` |
| Require review from Code Owners | ☑ |
| Require status checks to pass | ☑ |
| Branches up to date | ☑ |
| Require conversation resolution | ☑ |
| Require linear history | ☑ |
| Include administrators | ☑ |
| Allow force pushes | ☐ (unchecked) |
| Allow deletions | ☐ (unchecked) |

**Required status checks** (add each one):

| Check Name | Source Job |
|-----------|-----------|
| `validate` | Lint, test, audit, build, Lighthouse |
| `android` | Android build & test |
| `enrichment` | Python enrichment tests & migration validation |
| `security (npm-audit)` | npm audit |
| `security (pip-audit)` | pip-audit for enrichment |
| `security (bandit)` | Bandit static analysis |
| `security (secret-scanning)` | Gitleaks history scan |
| `security (config-check)` | Production config validation |
| `security (tfscan)` | Trivy Terraform scan |
| `integration` | PostgreSQL + LocalStack integration tests |
| `terraform-check` | Terraform fmt, init, validate |

> **Full documentation in**: [`.github/BRANCH-PROTECTION-SETTINGS.md`](/.github/BRANCH-PROTECTION-SETTINGS.md) — includes exact UI steps, check name rationale, and troubleshooting tips.

### Code Security & Analysis (`Settings → Code security and analysis`)

| Setting | Action |
|---------|--------|
| CodeQL scanning | ☑ Enable (or verify `codeql-analysis.yml` is active) |
| Private vulnerability reporting | ☑ Enable |
| Dependabot alerts | ☑ Enable |
| Dependabot security updates | ☑ Enable |

---

## Step-by-Step Instructions

### Branch Protection Setup

1. Go to **Settings → Branches** in the GitHub repository
2. Click **Add branch protection rule**
3. In **Branch name pattern**, enter `main`
4. Under **Protect matching branches**:
   - ☑ **Require a pull request before merging**
     - Set **Required approvals** to `1`
     - ☑ **Require review from Code Owners**
   - ☑ **Require status checks to pass before merging**
     - ☑ **Require branches to be up to date**
     - Search for and select each check from the table above
   - ☑ **Require conversation resolution before merging**
   - ☑ **Require linear history**
   - ☑ **Include administrators**
   - Ensure **Allow force pushes** is ☐ unchecked
   - Ensure **Allow deletions** is ☐ unchecked
5. Click **Create** (or **Save changes**)

### Code Security & Analysis Setup

1. Go to **Settings → Code security and analysis**
2. For each setting, click **Enable**:
   - **Private vulnerability reporting** → Enable
   - **Dependabot alerts** → Enable
   - **Dependabot security updates** → Enable
   - **CodeQL** → Enable (if not using the in-repo workflow)

---

## Verification Checklist

After applying all settings:

- [ ] Branch protection rule for `main` is active
- [ ] All 11 status checks are listed in the rule
- [ ] Administrators are included in enforcement
- [ ] Linear history is required
- [ ] Force pushes and deletions are blocked
- [ ] Code owners are set for all files
- [ ] Dependabot is configured for npm, pip, and GitHub Actions
- [ ] CodeQL is scanning on push/PR
- [ ] Private vulnerability reporting is enabled
- [ ] Dependabot alerts are enabled
- [ ] Dependabot security updates are enabled

---

## References

- [Branch Protection Settings (full UI guide)](/.github/BRANCH-PROTECTION-SETTINGS.md)
- [CI/CD Pipeline](/.github/workflows/ci-pages.yml)
- [Dependabot Configuration](/.github/dependabot.yml)
- [Code Owners](/.github/CODEOWNERS)
- [CodeQL Workflow](/.github/workflows/codeql-analysis.yml)
- [Architectural Survey](/plans/architectural-survey.md)
