---
owner: "@me"
last_reviewed: 2026-08-07
horizon: 6m
token_budget: 1000
---

# ChallanSe Memory Lifecycle

This file records deliberate instruction promotion, demotion and deletion.
It is not a session transcript or operational log.

## 2026-08-07

### Promotions

- Promoted local-first, synthetic-default and real-data readiness boundaries into root `AGENTS.md`.
  Reason: these rules affect every package and are expected to remain valid for the next six months.

- Promoted mobile encryption, offline queue and real-device evidence requirements into `apps/mobile/AGENTS.md`.
  Reason: these rules differ materially from web and backend packages.

- Promoted edge authorization and durable upload rules into `apps/edge/AGENTS.md`.
  Reason: these are Worker-specific security invariants.

- Promoted enrichment provider, Tesseract and data-redaction rules into `services/enrichment/AGENTS.md`.
  Reason: these are Python pipeline-specific invariants.

### Demotions

- Demoted AWS-first guidance introduced at commit `98ce5f9`.
  Reason: AWS deployment is frozen and Terraform, local services and synthetic acceptance are the active workflow.

- Demoted session-specific CLI errors and recovery commands from permanent instructions.
  Reason: recurring fixes belong in runbooks; one-off guidance belongs in `// codex:` comments or issue notes.

### Deletions

- Removed references to unavailable `retrieve_skill` and `aws-secrets-manager` capabilities.
  Reason: permanent instructions must describe tools that are actually callable.

- Removed universal construction-cost JSON output requirements from global memory.
  Reason: those requirements are project-specific and conflict with unrelated repositories.

### Pending Review

- Review PR #18 after merge or closure and update the episodic record.
- Reassess AWS freeze and local-pilot rules by 2026-11-07.
- Prune duplicated runbook guidance during the next quarterly review.
