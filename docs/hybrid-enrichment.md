# Hybrid enrichment activation

## Safe default

The Cloudflare Worker can operate with no enrichment configuration. It records `ENRICHMENT_DISABLED` and continues the manual reviewer workflow. The FastAPI service accepts signed events only when `CLOUDFLARE_SHARED_SECRET` is configured and acknowledges them only after the configured event queue accepts the task.

All external providers default to `disabled`:

| Variable | Allowed values | Production default |
| --- | --- | --- |
| `EVENT_QUEUE_PROVIDER` | `disabled`, `memory`, `celery` | `disabled` |
| `OCR_PROVIDER` | `disabled`, `mock`, `textract` | `disabled` |
| `GST_PROVIDER` | `disabled`, `mock`, `http` | `disabled` |
| `NOTIFICATION_PROVIDER` | `disabled`, `mock`, `whatsapp` | `disabled` |
| `CREDIT_PROVIDER` | `disabled`, `mock`, `sqs` | `disabled` |
| `SLACK_PROVIDER` | `disabled`, `mock`, `webhook` | `disabled` |

`memory` and `mock` are test-only and must never be used for real receipts.

## Service contract

Cloudflare signs each event with HMAC-SHA256 over `timestamp.request-id.body`. The service rejects missing, invalid, or older-than-60-second signatures. Cloudflare callbacks use the same contract and persist each request ID in D1 to prevent replay.

The worker fetches an image through the private internal Cloudflare endpoint, extracts available EXIF GPS, runs the configured OCR adapter, persists PostgreSQL evidence, and sends a signed projection callback. OCR confidence below 60 percent becomes `NEEDS_HUMAN_REVIEW`.

## Staging acceptance

1. Apply `services/enrichment/migrations/0001_enrichment.sql` to an isolated PostgreSQL database.
2. Configure Redis and set `EVENT_QUEUE_PROVIDER=celery`.
3. Use `OCR_PROVIDER=mock`; leave GST, notifications, credit, and Slack disabled.
4. Configure the same 32-byte random `CLOUDFLARE_SHARED_SECRET` in the service and Cloudflare Worker secret `ENRICHMENT_SHARED_SECRET`.
5. Set the Worker variable `ENRICHMENT_URL` to the private staging service URL.
6. Start the worker with `celery -A app.tasks.celery_app worker -Q challanse-enrichment`.
7. Process synthetic receipts and confirm private image authorization, PostgreSQL idempotency, callback replay rejection, and reviewer OCR evidence.
8. Do not enable real external providers until their dedicated legal, credential, redaction, timeout, circuit-breaker, and dead-letter acceptance checks pass.

## Known launch gates

- Rotate the exposed pre-release Android signing identity.
- Run an Android native build with a configured SDK and confirm the Gradle output includes `[OP-SQLITE] using sqlcipher.`
- Run the 100-write instrumentation test on Android 8 with a 2 GB device profile; JavaScript mock timing is not field evidence.
- Complete a two-device, 20-receipt offline/reboot/resume trial before the five-device pilot.
- Keep `PILOT_DEPLOY_ENABLED=false` until these gates are recorded in the release manifest.
