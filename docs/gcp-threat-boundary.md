# GCP Threat Boundary

- Firebase ID tokens identify users; verified email is mandatory.
- App Check reduces automated abuse but is not authorization.
- Every record and object is scoped to Firebase UID; direct Firestore and Storage rules deny all client access.
- Fifteen-minute signed URLs upload only into quarantine.
- Completion validates checksum, decoding, type, dimensions and size, strips metadata and stores normalized private WebP.
- Cloud Tasks and Scheduler invoke a separate private worker service with OIDC.
- OCR is advisory and every field requires confirmation.
- Razorpay webhooks require HMAC and idempotent event IDs.
- Support has no standing content access; users may grant one revocable hour.
- Logs exclude images, OCR text, email, authentication assertions and payment credentials.
- Retention is seven days free and 90 days paid; immediate deletion is available.
- Production still requires independent security, privacy, restore and Android evidence.
