---
owner: "@me"
last_reviewed: 2026-08-07
horizon: 6m
token_budget: 2000
---

# Semantic

- ChallanSe is a local-first receipt capture, review, reconciliation, and audit system. <!-- horizon: 6m -->
- The repository contains public landing, reviewer, edge, mobile, contracts, enrichment, and Terraform components. <!-- horizon: 6m -->
- Local operation defaults to synthetic-demo mode. <!-- horizon: 3m -->
- `AWS_DEPLOYMENT_FROZEN=true` and `PILOT_DEPLOY_ENABLED=false` remain required until explicitly approved. <!-- horizon: 3m -->
- Real client data is prohibited until the guarded readiness gates pass. <!-- horizon: 6m -->
- Public pages must expose no receipt, OCR, reviewer, credential, or local operational data. <!-- horizon: 6m -->
- Green CI or HTTP 200 is not sufficient client-readiness evidence. <!-- horizon: 6m -->

# Episodic

- 2026-07-18: AWS-only root guidance was introduced at commit `98ce5f9`; it is demoted because the active architecture is local-first and AWS-frozen. <!-- horizon: 3m -->
- 2026-07-31: PR #16 restored truthful CI and landing-page behavior without enabling production services. <!-- horizon: 6m -->
- 2026-08-07: PR #18 remains open; treat its changes as unmerged until GitHub reports otherwise. <!-- horizon: 1m -->

# Procedural

- Start with `git status --short` and confirm the authoritative checkout before editing. <!-- horizon: 6m -->
- Use `npm ci` for clean JavaScript dependency installation. <!-- horizon: 6m -->
- Run `npm run check`, `npm test`, and `npm run build` for root validation. <!-- horizon: 6m -->
- Run package-specific tests for every changed package. <!-- horizon: 6m -->
- Run Python tests from `services/enrichment/requirements-dev.txt`. <!-- horizon: 6m -->
- Validate Terraform with formatting, initialization and speculative plans; never apply while AWS is frozen. <!-- horizon: 3m -->
- Use `scripts/local-pilot.sh` for encrypted storage, local services, fixtures, acceptance, evidence and safe shutdown. <!-- horizon: 6m -->
- Keep synthetic fixtures deterministic and free of real client information. <!-- horizon: 6m -->
- Preserve resumable uploads, idempotency, audit integrity and offline queues when changing workflows. <!-- horizon: 6m -->
- Treat Android camera, SQLCipher, haptics and latency as unverified until tested on suitable hardware. <!-- horizon: 6m -->
- Keep bulky reproducible artifacts, caches and runtime data outside Git and off the home filesystem where configured. <!-- horizon: 6m -->
- Use additive, reversible migrations and regression tests for contract changes. <!-- horizon: 6m -->
- Never log images, OCR text, tokens, passwords, TOTP secrets or personal contacts. <!-- horizon: 6m -->
- Do not enable GST, credit, WhatsApp, Slack, AWS or public reviewer/API routes without separate approval. <!-- horizon: 6m -->
- Do not claim production readiness, compliance, uptime or OCR accuracy without current evidence. <!-- horizon: 6m -->

# Related Rules

- Mobile overrides: `apps/mobile/AGENTS.md`. <!-- horizon: 6m -->
- Edge overrides: `apps/edge/AGENTS.md`. <!-- horizon: 6m -->
- Enrichment overrides: `services/enrichment/AGENTS.md`. <!-- horizon: 6m -->
- Lifecycle decisions: `MEMORY.md`. <!-- horizon: 6m -->
