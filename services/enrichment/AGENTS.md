---
owner: "@me"
last_reviewed: 2026-08-07
horizon: 3m
token_budget: 500
---

# ChallanSe Enrichment Rules

- This file extends `../../AGENTS.md`. <!-- horizon: 3m -->
- Override root: validation - run Ruff or configured lint, Bandit and affected pytest suites. <!-- horizon: 3m -->
- Override root: providers - use deterministic mocks unless a provider is explicitly enabled. <!-- horizon: 3m -->
- Preserve asynchronous processing, stage idempotency and transactional audit records. <!-- horizon: 3m -->
- OCR and LLM output is advisory until reviewed; missing values remain null. <!-- horizon: 3m -->
- Keep Tesseract execution shell-free, allowlisted, timeout-bound and output-limited. <!-- horizon: 3m -->
- Never log OCR text, images, GST data, credentials or personal contacts. <!-- horizon: 6m -->
- Provider failure must fall back safely without inventing extracted data. <!-- horizon: 3m -->
