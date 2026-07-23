# ChallanSe local pilot operations manual

This manual operates the LAN-first, synthetic-only ChallanSe environment. It does not activate real client data, AWS, or Cloudflare remote access.

## Safety boundary

- Use only the generated synthetic WebP images and CSV files.
- Keep `AWS_DEPLOYMENT_FROZEN=true` and `PILOT_DEPLOY_ENABLED=false`.
- Enter the LUKS passphrase only in the terminal.
- Never place passwords, TOTP secrets, recovery codes, enrollment links, or real challans in screenshots or issue reports.
- The browser may run tests and download evidence. It cannot open storage, change the firewall, reset data, destroy containers, or close the encrypted filesystem.

## One-time UI prerequisites

The repository already expects Node, npm, Docker Compose, Firefox, Chromium/Chrome, Ollama, Tesseract, Java 17, Android SDK and ADB.

Install the project browser tools:

```bash
cd /home/taran/challanse-website
npm ci
npx playwright install chromium firefox
npx playwright --version
```

Optional VS Code extensions:

```bash
code --install-extension ms-playwright.playwright
code --install-extension ms-azuretools.vscode-docker
code --install-extension ms-python.python
```

Install the desktop launcher:

```bash
cd /home/taran/challanse-website
./scripts/local-pilot.sh install-launcher
```

Search the Ubuntu Applications menu for **ChallanSe Local Pilot**. The launcher opens a terminal, requests `sudo` and the LUKS passphrase, starts the LAN stack, validates readiness, and opens `/operator`.

## Start after reboot

```bash
cd /home/taran/challanse-website
sudo -v
./scripts/local-pilot.sh storage-open
findmnt --mountpoint /mnt/challanse-data
./scripts/local-pilot.sh start --lan
./scripts/local-pilot.sh status
```

Expected mount:

```text
/mnt/challanse-data /dev/mapper/challanse-local ext4
```

Expected final readiness line:

```text
GREEN: synthetic-demo services and integrity gates are ready.
```

Open:

- Operator: `https://<LAN-IP>:8444/operator`
- Reviewer: `https://<LAN-IP>:8444/`
- API health: `https://<LAN-IP>:8443/health`

The supervised browser must trust `~/.config/challanse-local/tls/pilot-ca.crt`.

## Daily pre-demo checklist

1. Run `./scripts/local-pilot.sh status`.
2. Confirm PostgreSQL, object storage, Tesseract, Ollama and the audit chain are ready.
3. Confirm the queue and terminal failures are zero.
4. Confirm storage is below 70%.
5. Confirm the pilot certificate is not warning or expired.
6. In `/operator`, confirm deterministic test data is ready.
7. Use only an acceptance pack marked `passed: true` and created in the latest 24 hours.

`activation.ready: false` and backup `MISSING` are expected in synthetic-demo mode. They prevent real-data activation and do not block synthetic testing.

## Complete browser test

Sign in as the individual organization administrator with password and TOTP. Open `/operator`, then select **Run complete synthetic test**.

The persisted stages are:

```text
PREWARM → FIXTURES → PREPARE → UPLOAD → OCR_DRAIN → CLEANUP → EVIDENCE → PASSED
```

Success requires:

- exactly 50 acknowledgements and 50 unique receipt IDs;
- durable acknowledgement before OCR drain;
- queue depth zero;
- acceptance tenant and objects removed;
- valid audit chain;
- evidence created only after a passing result.

One run may be active at a time. Browser refresh does not lose progress. Cancellation occurs at a safe stage boundary and still performs cleanup.

## Reviewer test

Use the separate reviewer interface:

1. Open Inbox.
2. Inspect the private synthetic image and OCR evidence.
3. Correct fields and verify or reject.
4. Confirm stale concurrent edits return `409`.
5. Open Delta.
6. Import CSV fixtures from `/mnt/challanse-data/fixtures`.
7. Confirm duplicate, malformed-header, unit-mismatch and over-PO behavior.
8. Confirm over-PO rows are bright red.
9. Export JSON and CSV audit evidence.
10. Sign out and confirm the session no longer opens authenticated pages.

## Automated UI validation

```bash
cd /home/taran/challanse-website
./scripts/test-local-ui.sh
```

Expected final line:

```text
Local operator and reviewer UI gates passed.
```

Playwright runs Chromium and Firefox at desktop, tablet and 390-pixel mobile widths. Failure evidence is stored under `artifacts/playwright` and `artifacts/playwright-report`.

## Android test

```bash
cd /home/taran/challanse-website
./scripts/local-pilot.sh download-apk
sha256sum artifacts/local-pilot/ChallanSe-Local-Pilot.apk
adb devices
adb install -r artifacts/local-pilot/ChallanSe-Local-Pilot.apk
./scripts/local-pilot.sh enroll
```

Verify synthetic label, offline save, app restart, queue preservation, charging plus approved Wi-Fi sync, interrupted upload resume, and device revocation. Do not share the one-time enrollment link.

## Safe stop

First verify queue depth is zero in `/operator` or `status`, then run:

```bash
cd /home/taran/challanse-website
./scripts/local-pilot.sh stop
./scripts/local-pilot.sh storage-close
```

Expected:

```text
Local services stopped. Mobile queues and synthetic data were preserved.
Encrypted ChallanSe container is closed.
```

## Troubleshooting

### Storage not mounted

```bash
sudo -v
./scripts/local-pilot.sh storage-open
findmnt --mountpoint /mnt/challanse-data
```

Do not run `storage-prepare` again.

### LAN address changed

```bash
./scripts/local-pilot.sh stop
./scripts/local-pilot.sh refresh-lan
./scripts/local-pilot.sh start --lan
```

Reinstall the regenerated public pilot CA only on supervised test devices.

### Browser certificate warning

Do not bypass it. Import `~/.config/challanse-local/tls/pilot-ca.crt`, verify the URL uses the configured LAN IP, and check certificate status in `/operator`.

### Ollama unavailable or cold

```bash
ollama list
docker ps --filter name=ollama
./scripts/local-pilot.sh start --lan
```

The approved model must be `qwen2.5:7b`. The local model receives OCR text only, never images or credentials.

### Tesseract language missing

The container must report `eng` and `hin`. Inspect:

```bash
docker compose -f deploy/local/docker-compose.yml exec api tesseract --list-langs
```

### Queue stalled or terminal failure

Do not start another acceptance run. Preserve the status and inspect:

```bash
./scripts/local-pilot.sh status
docker compose -f deploy/local/docker-compose.yml logs --tail=200 worker
```

Never paste raw OCR text or credentials into a public report.

### Acceptance already running

Return to `/operator` and monitor the active run. Use **Cancel safely** only if necessary.

### Cleanup failure

Do not use that run as evidence. Stop further testing and preserve the failed run artifacts and worker logs.

### Storage warning or upload pause

- At 70%, remove only expired synthetic evidence after reviewing it.
- At 90%, uploads pause and Android retains its local queue.
- Never delete PostgreSQL or image directories manually.

### Android device missing

```bash
adb kill-server
adb start-server
adb devices
```

Unlock the device and approve the USB debugging prompt.

### Playwright browser failure

```bash
npx playwright install chromium firefox
npx playwright show-report artifacts/playwright-report
```

Open the first failed screenshot and trace before changing code.

## Maintenance

Weekly:

```bash
./scripts/local-pilot.sh test-data
npm audit
python3 -m pip_audit -r services/enrichment/requirements.txt
```

Monthly:

- verify automatic deletion of test-run artifacts older than 30 days;
- run a synthetic restore exercise;
- inspect certificate expiry, disk use and dependency findings;
- retain only successful evidence needed for supervised demonstrations.

## Claims and limitations

This environment validates local workflow and usability only. It does not provide an SLA, statutory validation, independently verified OCR accuracy, unattended availability, cloud resilience, or production certification. Cloudflare remote access is a later supervised phase and must not be enabled until LAN acceptance passes.
