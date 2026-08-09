# ChallanSe GCP Production Runbook

## Boundary

This is the web-first GCP implementation. AWS remains frozen. Do not use real invoices until staging, security, privacy, backup and payment gates pass.

## Accounts and Projects

1. Create separate billing-linked `staging` and `production` GCP projects owned by Constrovet.
2. Enable MFA for every project owner and billing administrator.
3. Add `admin@constrovet.com` and one independent address as billing-budget recipients.
4. Configure Firebase Authentication with Google and email/password; require email verification.
5. Register one reCAPTCHA Enterprise site key per environment and enforce Firebase App Check.
6. Create the ₹499 monthly Razorpay plan only after KYC, tax and legal review.

Google Workspace licensing does not fund GCP resources. Billing alerts do not stop resources by themselves; the budget Pub/Sub handler closes new invoice processing at 90%.

## Local Validation

```bash
cd /media/taran/LargeStorage/taran/challanse-website
npm ci
npm run check --workspace @challanse/client
npm test --workspace @challanse/client
python3 -m venv /tmp/challanse-gcp-venv
source /tmp/challanse-gcp-venv/bin/activate
pip install -r services/gcp-api/requirements-dev.txt
PYTHONPATH=services/gcp-api pytest -q services/gcp-api/tests
terraform fmt -check -recursive infra/gcp
terraform -chdir=infra/gcp init -backend=false
terraform -chdir=infra/gcp validate
```

## Private Configuration

Keep Firebase environment values and Terraform variables outside Git. Never place billing IDs, Razorpay secrets or service-account keys in the repository. Prefer GitHub OIDC and Google Workload Identity Federation for CI.

```bash
cp apps/client/.env.example /secure/challanse-client-staging.env
cp infra/gcp/staging.tfvars.example /secure/challanse-staging.tfvars
export GCP_STAGING_PROJECT_ID='your-staging-project'
export GCP_STAGING_TERRAFORM_STATE_BUCKET='your-staging-project-challanse-tfstate'
export GCP_TFVARS_FILE='/secure/challanse-staging.tfvars'
export GCP_CLIENT_ENV_FILE='/secure/challanse-client-staging.env'
export AWS_DEPLOYMENT_FROZEN=true
export PILOT_DEPLOY_ENABLED=false
./scripts/gcp-live.sh preflight
```

## Two-phase staging deployment

Run each command separately and inspect every plan before applying it:

```bash
./scripts/gcp-live.sh bootstrap-state staging
./scripts/gcp-live.sh plan-bootstrap staging
./scripts/gcp-live.sh apply-bootstrap staging
./scripts/gcp-live.sh build-image staging
./scripts/gcp-live.sh plan-application staging
./scripts/gcp-live.sh deploy-staging
```

The bootstrap phase creates the private versioned Terraform-state bucket, APIs, Artifact Registry, service accounts, Firestore, private buckets, queues, budgets and empty Secret Manager containers. It does not create Cloud Run services.

The image phase builds the pinned OCR container only after Artifact Registry exists and records its immutable digest under `/tmp`. The application phase refuses a mutable image reference.

Billing defaults to disabled, so empty Razorpay secret containers do not block the free staging deployment. After KYC and legal approval, add secret versions through protected stdin or the Console, set `GCP_BILLING_ENABLED=true`, and rerun the application plan. Never place secret values in `.tfvars`, shell arguments or Git.

## Staging Acceptance

- Test Google and verified email/password sign-in.
- Reject unverified identities and missing App Check tokens.
- Accept JPEG, PNG and WebP below 5 MB; reject every other input.
- Process 550 synthetic invoices without loss or duplicate completion.
- Verify free 3/day and paid 25/day limits under concurrency.
- Verify OCR failure produces `Needs correction` without losing uploads.
- Verify deletion, seven-/90-day retention and one-hour support grants.
- Verify Razorpay signature, replay protection, activation, cancellation and grace.
- Verify cross-user invoice, image and export denial.
- Complete browser accessibility at 390×844, 768×1024 and 1440×900.
- Restore metadata and objects inside one business day.
- Require zero unresolved critical/high findings.

## Production

Production remains human-approved. Map `app.challanse.constrovet.com` only after Firebase issues HTTPS. Keep the public sample page separate.

```bash
export GCP_PRODUCTION_PROJECT_ID='your-production-project'
export GCP_PRODUCTION_TERRAFORM_STATE_BUCKET='your-production-project-challanse-tfstate'
export GCP_TFVARS_FILE='/secure/challanse-production.tfvars'
export GCP_CLIENT_ENV_FILE='/secure/challanse-client-production.env'
export GCP_PRODUCTION_APPROVED=true
./scripts/gcp-live.sh bootstrap-state production
./scripts/gcp-live.sh plan-bootstrap production
./scripts/gcp-live.sh apply-bootstrap production
./scripts/gcp-live.sh build-image production
./scripts/gcp-live.sh plan-application production
./scripts/gcp-live.sh deploy-production
```

Review billing daily during launch. At 90%, verify processing closes. Reopen only after the allowance of ₹1,000 plus 20% of collected subscription revenue is approved. Run restore tests quarterly and publish no uptime, OCR-accuracy, statutory or certification claim.
## Backup and restore

- Terraform schedules a daily Firestore export to the private regional backup bucket and retains versions for 35 days.
- Invoice objects remain versioned in the private invoice bucket; deletion and retention behavior must be tested in staging.
- Before production approval, restore the latest Firestore export into a disposable staging project and verify invoice metadata against private objects.
- Record the export operation ID, restore project, timestamps, counts and operator in the release evidence. A configured schedule is not restore proof.
