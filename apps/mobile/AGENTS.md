---
owner: "@me"
last_reviewed: 2026-08-07
horizon: 3m
token_budget: 500
---

# ChallanSe Mobile Rules

- This file extends `../../AGENTS.md`. <!-- horizon: 3m -->
- Override root: validation - run TypeScript, Jest and the affected Gradle variant. <!-- horizon: 3m -->
- Override root: storage - preserve OP-SQLite SQLCipher and Android Keystore protection. <!-- horizon: 3m -->
- Override root: capture - preserve immediate confirmed local persistence before UI dismissal. <!-- horizon: 3m -->
- Override root: sync - preserve offline queues, idempotency and resumable progress. <!-- horizon: 3m -->
- Keep production, local-pilot and client-pilot identities and endpoints separate. <!-- horizon: 3m -->
- Never commit signing keys, passwords, local CA private keys, APKs or generated credentials. <!-- horizon: 6m -->
- Do not claim camera, haptic, SQLCipher or latency success without real-device evidence. <!-- horizon: 3m -->
- Keep Android 8 and constrained-device behavior in scope. <!-- horizon: 3m -->
