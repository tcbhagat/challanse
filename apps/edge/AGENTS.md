---
owner: "@me"
last_reviewed: 2026-08-07
horizon: 3m
token_budget: 500
---

# ChallanSe Edge Rules

- This file extends `../../AGENTS.md`. <!-- horizon: 3m -->
- Override root: validation - run TypeScript, Vitest and the Wrangler dry-run build. <!-- horizon: 3m -->
- Override root: authorization - enforce exact origin, site scope and authenticated identity. <!-- horizon: 3m -->
- Override root: persistence - preserve upload idempotency and durable acknowledgement rules. <!-- horizon: 3m -->
- Keep Workers stateless unless an approved binding explicitly requires persistence. <!-- horizon: 3m -->
- Treat D1 migrations as additive and test upgrade paths. <!-- horizon: 3m -->
- Never expose private objects, device tokens, Access assertions or internal origins. <!-- horizon: 6m -->
- Do not create public reviewer or API routes while remote access is out of scope. <!-- horizon: 3m -->
