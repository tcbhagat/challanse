# ChallanSe — Local Synthetic Pilot

Multi-tenant construction receipt capture and reconciliation for Android field devices and finance reviewers.

## Project Status

> **This is a local synthetic pilot.** Cloud deployment (AWS) is currently frozen. All services run locally for development and testing. The public website is informational only — no real invoices are processed through it. Reviewer and API services are local-only until a separate remote rollout is approved.

| Aspect | Status |
|---|---|
| **Cloud infrastructure (AWS)** | Frozen since 2026-07-18. No `terraform apply`, deployments, or provisioning. |
| **Local development & testing** | Active. All services run via local containers (PostgreSQL, LocalStack). |
| **Public website** (`challanse.constrovet.com`) | Informational only. No real invoices submitted or processed. |
| **Reviewer UI** (`review.challanse.constrovet.com`) | Available locally only; not deployed remotely. |
| **API** (`api.challanse.constrovet.com`) | Available locally only; not deployed remotely. |
| **Android mobile app** | Built and tested locally; private distribution is frozen. |
| **Invoice/receipt processing** | Synthetic test data only. No real invoices should be submitted. |

This is a **demonstration and prototype** project, not a production service. The architecture, deployment automation, and infrastructure code document a planned production design that will remain inactive until cloud deployment is unfrozen, requirements are revised, and funding is approved.

---

## Planned capabilities

These describe the target design. Nothing in this section is operational in production today.

- Offline-first Android 8+ manual capture with SQLCipher, Android Keystore, WorkManager, 256 KB resumable parts, seven-day acknowledged-image grace, and indefinite retention of unsynced receipts.
- Enterprise OIDC reviewer access with MFA, immutable issuer/subject identities, organization/site roles, PostgreSQL row-level security, and tenant-scoped S3 objects.
- Textract-assisted OCR, manual correction, optimistic review locking, Tally CSV reconciliation, audit history, and organization-scoped JSON/CSV exports.
- Managed Google Play private AAB distribution for approved client organization IDs.
- GST, credit, WhatsApp, Slack, and individual notifications remain disabled.

Initial design capacity is three clients, 100 devices, about 20 sites, and 1,000 receipts daily. The service target is 99.5% availability, RPO no greater than one hour, and RTO no greater than eight hours. These are release targets, not contractual guarantees, until production monitoring and restore exercises provide evidence.

## Reference architecture

The following describes the *planned* runtime boundaries. None of the remote endpoints are currently operational outside of local development.

- `challanse.constrovet.com`: buyer site and protected pilot-request endpoint.
- `review.challanse.constrovet.com`: Access-protected reviewer and tenant administration UI.
- `api.challanse.constrovet.com`: stateless Cloudflare Worker routing to the private AWS API.
- `apps/mobile`: Android capture and synchronization application.
- `services/enrichment`: FastAPI ingestion, SQS workers, PostgreSQL workflows, OCR, review, reconciliation, retention, exports, and telemetry.
- `infra/terraform`: separate staging and production AWS account stacks in `ap-south-1`.

Original WebP images live in private, versioned, SSE-KMS S3. Receipt, reviewer, device, OCR, reconciliation, and audit records live in RDS PostgreSQL. Cloudflare does not store application receipt payloads.

## Local development

### Prerequisites

Requires Node.js 24, Java 17, Android SDK, Docker, Terraform 1.9, ShellCheck, and GitHub CLI.

```bash
npm ci
npm run check
npm test
npm run test:enrichment
npm run build
bash scripts/test-edge-integration.sh
bash scripts/test-production-config.sh
npm run build --workspace @challanse/mobile
```

Integration tests use PostgreSQL and LocalStack containers to exercise RLS, idempotency, invitations, SQS, reconciliation, and lifecycle jobs.

### Local synthetic testing

Local staging uses synthetic PostgreSQL and LocalStack containers, then removes them. This is the currently supported operating mode:

```bash
cd /path/to/challanse-website
./scripts/zero-cost-readiness.sh status
./scripts/zero-cost-readiness.sh install-terraform
./scripts/zero-cost-readiness.sh local-staging
```

The speculative Terraform plan command below uses no backend, performs no apply, and is safe to run for review:

```bash
AWS_PROFILE=challanse-staging ./scripts/zero-cost-readiness.sh speculative-plan
```

### Guard flags

The following environment variables are set and must remain at these values while the deployment freeze is in effect:

```
PILOT_DEPLOY_ENABLED=false
AWS_ENRICHMENT_BOOTSTRAPPED=false
AWS_DEPLOYMENT_FROZEN=true
```

## Deployment

### Current status: frozen

AWS deployment has been frozen since **2026-07-18** pending revised requirements and funding. The following are **preserved**:

- Existing AWS accounts and infrastructure code (Terraform)
- CI/CD configuration and GitHub Actions workflows
- Deployment scripts and automation (`scripts/go-live.sh`, `scripts/rollback-production.sh`, etc.)
- Architecture and design documentation

The following are **prohibited** while the freeze is in effect:

- Organization bootstrap or `terraform apply`
- AWS configuration commands (tunnels, identity, enrichment)
- Deployment, seeding, or production migration
- Android private distribution (Managed Google Play)
- Submission or processing of any real invoices through the public website

### Reactivation gates

Cloud deployment may resume only when all of the following are satisfied:

1. Approved client requirements are documented
2. Written cloud spending approval is obtained
3. AWS ownership and billing alerts are confirmed
4. A reviewed Terraform estimate is produced
5. Signing and CI security gates pass
6. `AWS_DEPLOYMENT_FROZEN` is explicitly changed to `false` before a guarded typed deployment confirmation

See [`docs/aws-deployment-freeze.md`](docs/aws-deployment-freeze.md) for the preserved assets, prohibited commands, and complete reactivation gate checklist.

### Guarded production sequence (reference)

The following sequence documents the *planned* go-live procedure. It is not executable today:

```bash
cd /path/to/challanse-website
git pull --ff-only

./scripts/go-live.sh preflight
./scripts/go-live.sh provision
./scripts/go-live.sh configure-identity
./scripts/go-live.sh configure-github
./scripts/go-live.sh rotate-signing
./scripts/go-live.sh configure-aws
./scripts/go-live.sh configure-enrichment
./scripts/go-live.sh configure-tunnel-origin
./scripts/go-live.sh configure-play
./scripts/go-live.sh accept-staging /secure/staging-acceptance.json
./scripts/go-live.sh accept-android-field /secure/android-field-acceptance.json
./scripts/go-live.sh accept-security /secure/security-acceptance.json
./scripts/go-live.sh accept-capacity /secure/capacity-acceptance.json
./scripts/go-live.sh accept-recovery /secure/recovery-acceptance.json
./scripts/go-live.sh accept-client /secure/client-acceptance.json
./scripts/go-live.sh harden-github
./scripts/go-live.sh deploy
```

The previously exposed keystore is revoked and must never be opened, copied, or reused. `rotate-signing` creates a new upload key outside the repository, records the revoked and active upload fingerprints, and preserves Google Play's separate app-signing fingerprint. Production builds AABs only; direct APK distribution is prohibited.

`provision` is intentionally stateless: it configures Turnstile, reviewer Access, DNS, GitHub variables, and routing without creating D1, R2, or Cloudflare Queues. `configure-identity` permits one enterprise OIDC provider, forces MFA, and leaves PostgreSQL membership as the final authorization check. After Terraform creates the private HTTPS ALB, `configure-tunnel-origin` sets Cloudflare Tunnel to validate its certificate with `api.challanse.constrovet.com` as the TLS server name; `noTLSVerify` is never enabled.

### Tenant onboarding (reference)

When deployment is active, tenant onboarding uses a private vendor file:

```json
[
  {"id":"vendor-approved-id","name":"Approved vendor name","initials":"AV","color":"#006D77"}
]
```

```bash
./scripts/go-live.sh seed --vendors-file /secure/challanse-vendors.json
./scripts/go-live.sh set-play-track internal
./scripts/go-live.sh deploy
./scripts/go-live.sh download-aab
./scripts/go-live.sh verify
```

The seed command runs a guarded private ECS bootstrap task and binds the first administrator to an immutable OIDC issuer/subject. Additional users join through single-use membership invitations. Android devices enroll with separate single-use 10-minute codes and store revocable device credentials in Android Keystore.

Managed Google Play organization availability is configured in Play Console and evidenced by a canonical organization-ID hash; the IDs are not committed. Promote `internal` to `alpha`, and then `production`, only after recorded client acceptance.

### Operations (reference)

Production remains disabled unless the guarded CLI temporarily sets `PILOT_DEPLOY_ENABLED=true`; it restores the variable to `false` on completion or failure. AWS deployment is additionally blocked while `AWS_DEPLOYMENT_FROZEN=true`. Protected `main` requires `validate`, `android`, `enrichment`, `security`, `integration`, and `terraform-plan`. Security, capacity, and recovery reports must reference hashed evidence artifacts and pass strict typed thresholds before deployment. Every release manifest records commit, workflow run, AAB checksum, upload and Play signing fingerprints, revoked fingerprint, SBOM, image digest, migrations, acceptance evidence, and deployed Worker versions.

Production OCR uses Textract. GST, credit, WhatsApp, Slack, and individual alerts fail closed and remain visibly disabled. Do not claim GST validation, automated statutory compliance, credit eligibility, OCR accuracy, savings, ISO certification, or DPDP legal compliance without independent evidence.

Business-hours support is documented in `docs/pilot-runbook.md`; no 24×7 support is offered. Follow `docs/aws-bootstrap.md`, `docs/hybrid-enrichment.md`, `docs/release-readiness.md`, and `docs/pilot-runbook.md` before onboarding a client.

The three-month pilot is governed by `docs/pilot-budget.md`: INR 450,000 total cash ceiling, INR 60,000 combined monthly cloud ceiling, separate staging/production budgets, two-operator alerts, and stop/reapproval gates. Passing technical checks does not authorize expenditure beyond those controls.

### Emergency stop

If production were active, the following would preserve server data and every device's local queue:

```bash
./scripts/rollback-production.sh
./scripts/rollback-production.sh --revoke-devices
```

---

## Additional documentation

- [`docs/local-pilot.md`](docs/local-pilot.md) — Zero-budget, synthetic, local-LLM client demonstration environment
- [`docs/local-testing-runbook.md`](docs/local-testing-runbook.md) — Beginner-safe execution steps and expected results
- [`docs/local-operations-manual.md`](docs/local-operations-manual.md) — Daily operation and troubleshooting
- [`docs/aws-deployment-freeze.md`](docs/aws-deployment-freeze.md) — Preserved assets, prohibited commands, and reactivation gate
