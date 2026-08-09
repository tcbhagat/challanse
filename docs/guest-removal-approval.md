# Guest Rollout Removal Approval List

No item below is removed by this change.

| Candidate | Why obsolete or risky | Replacement | Impact | Rollback | Required tests |
|---|---|---|---|---|---|
| Contact-only real-invoice CTA | Does not perform invoice processing | `guest.challanse.constrovet.com` Access flow | Public CTA changes destination | Restore prior anchor | Landing Chromium/Firefox |
| Legacy pilot dialog and inert pilot controls | Separate lead-capture workflow is unrelated to invoice processing | Existing contact page remains available from footer | No guest data migration | Restore dialog markup and runtime config | Landing build and CSP tests |
| AWS enrichment variables and bindings | AWS is frozen and must not be a hidden guest fallback | Cloudflare Queue and Workers AI with hard limits | Registered enrichment needs separate migration review | Restore bindings from Git | Production-config and queue tests |
| Unauthenticated service event routes | Could bypass subject/workspace authorization | Signed service authentication or no public route | External senders remain disabled | Re-enable only with signed contract | Forgery/replay tests |
| Orphan upload CSS and generated reports | Can misrepresent inactive features or pollute source | Guest component styles and generated evidence outside Git | Cosmetic/build cleanup only | Restore from Git | Selector and visual tests |

Deletion requires a separate explicit approval after reference search, migration analysis and rollback verification.
