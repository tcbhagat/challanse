# Guest Service Threat Boundary

## Scope

The guest service is a temporary, Access-authenticated workspace for one invoice image. It is separate from registered organizations, sites, devices, reviewers and receipts.

## Trust Boundaries

- Cloudflare Access validates the one-time-PIN session before the guest Worker serves or proxies private requests.
- The API independently validates the Access JWT issuer, audience, expiry and subject.
- The API derives subject and email hashes with `GUEST_IDENTITY_PEPPER`; plaintext email is not persisted.
- Every mutation requires the exact guest origin and a workspace-scoped CSRF token held only in page memory.
- Every workspace lookup binds the random workspace ID to the authenticated subject hash and unexpired record.
- R2 objects are private and use random workspace and receipt identifiers. No object URL is returned.
- Guest tables, object prefixes, queue messages and handlers are distinct from registered-client data.

## Abuse and Failure Controls

- One active workspace per Access identity.
- Three accepted invoices per identity per UTC day, ten workspace attempts per IP hash, and fifty accepted uploads globally.
- A 9,000-neuron daily application ceiling reserves 500 neurons before upload, below the 10,000-neuron free allocation.
- Missing usage metrics, an unavailable model, timeout, invalid output or reservation overrun becomes `NEEDS_CORRECTION`; acknowledged images remain available for manual confirmation.
- JPEG, PNG and WebP only; 5 MB maximum; magic bytes, MIME, dimensions and SHA-256 are checked after resumable assembly.
- Upload parts require contiguous offsets and per-part SHA-256. Duplicate completion returns the existing receipt.
- Scheduled and immediate deletion remove objects and private rows, then retain only a non-identifying tombstone.

## Log Prohibitions

Do not log Access assertions, email addresses, IP addresses, CSRF tokens, images, OCR text, model responses, filenames or extracted invoice fields.

## Residual Risks

- Access OTP proves control of an email inbox, not a legal identity.
- Cloudflare storage is globally distributed; India-only residency is not claimed.
- Workers AI is assistive. Every field requires guest confirmation.
- This implementation is standards-aligned but has not been independently certified.
- Production remains disabled until staging security and acceptance gates pass.
