# Branch Protection Settings for `main`

> **IMPORTANT — Two distinct states are documented in this file:**
>
> 1. **Current actual GitHub settings** — what is enforced *today* on GitHub.
> 2. **Documented target policy (pending application)** — the stricter, full
>    governance policy. It is **NOT yet applied** and must not be assumed to be
>    live.
>
> Applying the target policy is a manual/operational step (e.g. via
> `./scripts/go-live.sh harden-github`) that **must NOT be run during the
> CI-restoration task**.

---

## 1. Current Actual GitHub Settings

The live GitHub branch protection for `main` currently requires **ONLY** the
following status checks:

- `validate`
- `android`

The stricter policy documented in [Section 2](#2-documented-target-policy-pending-application)
below is **NOT yet applied**. Nothing in this repository should be read as
implying that the full 11-check policy is live.

---

## 2. Documented Target Policy (pending application)

> **Status: PENDING.** The settings below are the intended target
> configuration. They are enforced only after a manual/operational application
> step (e.g. `./scripts/go-live.sh harden-github`) has been completed. Do not
> treat them as the current live configuration.

These settings are configured through the **GitHub API / UI** (branch
protection rules cannot be defined in-repo).

**Navigation**: Repository → **Settings** → **Branches** → **Add branch
protection rule** (or edit the existing `main` rule)

### Rule: Branch name pattern

```
main
```

### Required Settings

#### ☑ Require a pull request before merging

| Setting | Value |
|---------|-------|
| Required approvals | `1` |
| Dismiss stale pull request approvals when new commits are pushed | ☐ (unchecked — optional) |
| Require review from Code Owners | ☑ (checked) |

#### ☑ Require status checks to pass before merging

| Setting | Value |
|---------|-------|
| Require branches to be up to date | ☑ (checked) |

**Status checks that must pass:**

These are the exact check names as they appear in the CI workflow
(`.github/workflows/ci-pages.yml`). Add each one:

- `validate`
- `android`
- `enrichment`
- `security (npm-audit)`
- `security (pip-audit)`
- `security (bandit)`
- `security (secret-scanning)`
- `security (config-check)`
- `security (tfscan)`
- `integration`
- `terraform-check`

> **Note on `security` matrix**: The `security` job uses a
> `strategy.matrix` with six independent checks. Each matrix variant creates a
> separate status check named `security (<variant>)`. All six must be listed
> individually. The matrix uses `fail-fast: false` so each check reports
> independently.
>
> **Note on `terraform-plan`**: This job is gated behind
> `vars.AWS_DEPLOYMENT_FROZEN != 'true'` and will not run when the freeze is
> active. It is **intentionally NOT** a required check. Use `terraform-check`
> as the required one, which always runs (format, init, validate on both
> staging and production).

#### ☑ Require conversation resolution before merging

| Setting | Value |
|---------|-------|
| Require conversation resolution | ☑ (checked) |

#### ☑ Require linear history

| Setting | Value |
|---------|-------|
| Require linear history | ☑ (checked) |

#### ☑ Include administrators

| Setting | Value |
|---------|-------|
| Include administrators | ☑ (checked) — enforce these rules for everyone (`enforce_admins: true`) |

#### ☐ Restrict who can push to matching branches

Leave this **empty** unless specific teams or users should be the only ones
allowed to push. The pull request requirement and status checks already enforce
governance. (The `harden-github` script sends `restrictions: null`.)

#### ☐ Allow force pushes

| Setting | Value |
|---------|-------|
| Allow force pushes | ☐ **ENSURE UNSELECTED** |

#### ☐ Allow deletions

| Setting | Value |
|---------|-------|
| Allow deletions | ☐ **ENSURE UNSELECTED** |

---

## Applying the Target Policy (operational step)

Applying the target policy is a **manual, operator-gated step** that is
deliberately **out of scope** for the CI-restoration task:

1. When approved, the target policy can be applied via:
   ```
   ./scripts/go-live.sh harden-github
   ```
   (this requires the interactive `HARDEN MAIN` confirmation and a clean
   `main` with a green CI run).
2. Alternatively, apply it manually through the GitHub UI following the steps
   below.

### Manual UI steps

1. Go to **Settings → Branches**
2. Click **Add branch protection rule** (or edit an existing `main` rule)
3. Enter `main` as the branch name pattern
4. Configure all checkboxes as listed in [Section 2](#2-documented-target-policy-pending-application)
5. In the **Status checks found in the last week for this repository** search
   box, type and select each check name listed above
6. Click **Create** (or **Save changes**)

> **Tip**: If a status check hasn't run yet (e.g., on a new repo), it won't
> appear in the dropdown. Trigger a PR or push to `main` first so GitHub
> registers the check names, then come back to add them.

---

## Related Security & Analysis Settings

These are also configured in the GitHub UI under **Settings → Code security and
analysis**:

| Setting | Status |
|---------|--------|
| CodeQL scanning | ☑ Enable (or ensure the `codeql-analysis.yml` workflow is present — see below) |
| Private vulnerability reporting | ☑ Enable |
| Dependabot alerts | ☑ Enable |
| Dependabot security updates | ☑ Enable |

> **CodeQL**: The repository includes `.github/workflows/codeql-analysis.yml`
> (GitHub auto-detects workflows in `.github/workflows/`) which runs CodeQL on
> push/PR to `main` with the `security-and-quality` query suite for
> JavaScript/TypeScript and Python. Alternatively, you can enable CodeQL
> directly in the UI under **Code security and analysis → CodeQL → Set up** and
> let GitHub create its own workflow.
