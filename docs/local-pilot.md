# ChallanSe Local Synthetic Pilot

This environment is for supervised client demonstrations with synthetic data only. AWS deployment remains frozen. Images, OCR text, PostgreSQL data, and exports stay on the encrypted pilot disk. Cloudflare Tunnel, when explicitly started, transports encrypted traffic but does not store receipt payloads.

## Safety Boundary

- Never use real challans, vendors, people, GST numbers, bank details, or Tally exports.
- Do not run `storage-prepare` until `/dev/sda2` is backed up and explicitly disposable.
- `storage-prepare` permanently erases `/dev/sda2` and does not configure automatic startup.
- LAN startup requires UFW rules restricted to the detected local subnet.
- Remote startup is optional and requires a dedicated Cloudflare Tunnel plus Access application allowing only `admin@constrovet.com` and `bhagat.taran@gmail.com`.
- The PC must remain on during a demonstration. Mobile receipts remain queued when it is off.

## First Setup

Run one command at a time:

```bash
cd /home/taran/challanse-website
./scripts/local-pilot.sh preflight
./scripts/local-pilot.sh storage-audit
```

Preflight requires Android SDK 36, Build Tools `36.0.0`, and NDK `27.1.12297006` so the sideloadable synthetic APK can be built locally. It stops with a clear error and creates nothing when these components are absent.

Stop and inspect the storage audit. Only after confirming backups and disposability:

```bash
./scripts/local-pilot.sh storage-prepare
./scripts/local-pilot.sh firewall-prepare
./scripts/local-pilot.sh provision
```

The local reviewer password is entered during provisioning and is not printed or stored in plaintext. Install `~/.config/challanse-local/tls/pilot-ca.crt` as a trusted certificate only on supervised reviewer devices. The Android local-pilot APK contains only that public pilot CA certificate.

## Start a LAN Demonstration

```bash
./scripts/local-pilot.sh start --lan
./scripts/local-pilot.sh seed
./scripts/local-pilot.sh status
./scripts/local-pilot.sh download-apk
```

Install `artifacts/local-pilot/ChallanSe-Local-Pilot.apk` on the test Android device. Then generate a ten-minute enrollment link:

```bash
./scripts/local-pilot.sh enroll
```

Open the link on the Android device. The app name and persistent banner both identify the build as synthetic.

## Optional Remote Demonstration

In Cloudflare Zero Trust, create a dedicated pilot tunnel and two public hostnames:

- `api-pilot.challanse.constrovet.com` to `http://edge:8787`
- `review-pilot.challanse.constrovet.com` to `http://reviewer-worker:8788`

Protect the reviewer hostname with Cloudflare Access and allow only the two approved reviewer emails. Do not protect the mobile API hostname with browser login; mobile authentication uses revocable device tokens and request nonces. Then run:

```bash
./scripts/local-pilot.sh start --both
```

The CLI requests the tunnel token, Access team domain, and Access audience without printing them. Remote access exists only while the supervised tunnel container is running.

## Acceptance and Evidence

```bash
./scripts/local-pilot.sh acceptance
./scripts/local-pilot.sh evidence
```

The acceptance command uploads 50 generated WebP receipts through resumable upload contracts, verifies durable acknowledgements, and waits up to 30 minutes for the sequential OCR queue to drain. It does not replace the required Android 8 / 2 GB device write test.

Evidence is written under `/srv/challanse/exports`. It includes the commit, container identities, model list, OCR versions, APK checksum, and explicit limitations. It does not contain passwords, device tokens, CA private keys, or tunnel credentials.

## Stop or Reset

```bash
./scripts/local-pilot.sh stop
```

Stopping preserves PostgreSQL, images, fixtures, and mobile queues. To recreate only server-side synthetic records:

```bash
./scripts/local-pilot.sh reset
```

To delete all local synthetic server data and secrets while preserving the encrypted disk itself:

```bash
./scripts/local-pilot.sh destroy
```

## Honest Limitations

- This validates workflow and usability, not production resilience or real OCR accuracy.
- OCR normalization can be slow on CPU and runs one receipt at a time.
- Low-confidence, unavailable, invalid, or untraceable model output requires human review.
- There is no independent off-device backup.
- No statutory, GST, credit, notification, or financial-production integration is enabled.
