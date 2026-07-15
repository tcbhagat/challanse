#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/apps/edge/wrangler.toml"
STATE="$(mktemp -d)"
PORT=8791
LOG="$STATE/wrangler.log"
cleanup() {
  if [[ -n "${WORKER_PID:-}" ]]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  rm -rf "$STATE"
}
trap cleanup EXIT

cd "$ROOT"
npx wrangler d1 migrations apply challanse-pilot --local --persist-to "$STATE" --config "$CONFIG" >/dev/null
CODE="ABCDEFGH"
CODE_HASH="$(node -e "const c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(process.argv[1]).digest('hex'))" "$CODE")"
LIMIT_CODE="BCDEFGHJ"
LIMIT_CODE_HASH="$(node -e "const c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(process.argv[1]).digest('hex'))" "$LIMIT_CODE")"
SEED="INSERT INTO sites (id,name,allowed_wifi_ssids_json) VALUES ('site-1','Pilot Site','[\"SITE_WIFI\"]'),('site-full','Full Site','[\"SITE_WIFI\"]'); INSERT INTO vendors (id,site_id,name,initials,color,display_order) VALUES ('vendor-1','site-1','Pilot Vendor','PV','#f59e0b',0); INSERT INTO enrollment_codes (code_hash,site_id,device_name,expires_at,created_by) VALUES ('$CODE_HASH','site-1','Gate One',datetime('now','+10 minutes'),'admin@example.com'),('$LIMIT_CODE_HASH','site-full','Gate Six',datetime('now','+10 minutes'),'admin@example.com'); INSERT INTO devices (id,site_id,name,token_hash,app_version) VALUES ('full-1','site-full','One','full-token-1','1.0.0'),('full-2','site-full','Two','full-token-2','1.0.0'),('full-3','site-full','Three','full-token-3','1.0.0'),('full-4','site-full','Four','full-token-4','1.0.0'),('full-5','site-full','Five','full-token-5','1.0.0');"
npx wrangler d1 execute challanse-pilot --local --persist-to "$STATE" --config "$CONFIG" --command "$SEED" >/dev/null

npx wrangler dev --local --test-scheduled --persist-to "$STATE" --port "$PORT" --config "$CONFIG" --var DEVICE_TOKEN_PEPPER:test-pepper >"$LOG" 2>&1 &
WORKER_PID=$!
for _ in {1..30}; do curl --fail --silent "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
curl --fail --silent "http://127.0.0.1:$PORT/health" | grep -q '"ok"'

ENROLL="$(curl --fail --silent -X POST "http://127.0.0.1:$PORT/v1/devices/enroll" -H 'Content-Type: application/json' --data "{\"enrollmentCode\":\"$CODE\",\"deviceName\":\"Gate One\",\"appVersion\":\"1.0.0\"}")"
TOKEN="$(node -e "const p=JSON.parse(process.argv[1]);if(!p.deviceToken)process.exit(1);process.stdout.write(p.deviceToken)" "$ENROLL")"
curl --fail --silent "http://127.0.0.1:$PORT/v1/mobile/bootstrap" -H "Authorization: Bearer $TOKEN" | grep -q 'Pilot Vendor'

LIMIT_RESPONSE="$(curl --silent -w '\n%{http_code}' -X POST "http://127.0.0.1:$PORT/v1/devices/enroll" -H 'Content-Type: application/json' --data "{\"enrollmentCode\":\"$LIMIT_CODE\",\"deviceName\":\"Gate Six\",\"appVersion\":\"1.0.0\"}")"
[[ "${LIMIT_RESPONSE##*$'\n'}" == "409" ]]
grep -q 'DEVICE_LIMIT' <<<"$LIMIT_RESPONSE"
LIMIT_CODE_RESULT="$(npx wrangler d1 execute challanse-pilot --local --persist-to "$STATE" --config "$CONFIG" --command "SELECT used_at FROM enrollment_codes WHERE code_hash = '$LIMIT_CODE_HASH';" --json)"
jq -e '.[0].results[0].used_at == null' >/dev/null <<<"$LIMIT_CODE_RESULT"

IMAGE="$STATE/receipt.webp"
printf 'RIFF\x04\x00\x00\x00WEBP' > "$IMAGE"
IMAGE_HASH="$(node -e "const fs=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$IMAGE")"
RECEIPT_ID="0195279a-7f6f-4af8-bc14-28640f0aa99a"
METADATA="{\"receiptId\":\"$RECEIPT_ID\",\"vendorId\":\"vendor-1\",\"capturedAtUnix\":1800000000,\"capturedQuantity\":10,\"imageSha256\":\"$IMAGE_HASH\",\"appVersion\":\"1.0.0\",\"configurationVersion\":1}"
upload() {
  local nonce="$1"
  curl --silent -w '\n%{http_code}' -X POST "http://127.0.0.1:$PORT/v1/receipts" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-ChallanSe-Nonce: $nonce" \
    -H "X-ChallanSe-Timestamp: $(date +%s)" \
    -F "metadata=$METADATA" -F "image=@$IMAGE;type=image/webp"
}
FIRST="$(upload nonce-0000000000000001)"
[[ "${FIRST##*$'\n'}" == "202" ]]
SECOND="$(upload nonce-0000000000000002)"
[[ "${SECOND##*$'\n'}" == "202" ]]
grep -q '"duplicate":true' <<<"$SECOND"
REPLAY="$(upload nonce-0000000000000002)"
[[ "${REPLAY##*$'\n'}" == "409" ]]
grep -q 'REPLAY_REJECTED' <<<"$REPLAY"

npx wrangler d1 execute challanse-pilot --local --persist-to "$STATE" --config "$CONFIG" --command "UPDATE receipts SET created_at=datetime('now','-91 days') WHERE id='$RECEIPT_ID';" >/dev/null
curl --fail --silent "http://127.0.0.1:$PORT/__scheduled?cron=15+2+*+*+*" >/dev/null
RETENTION_RESULT="$(npx wrangler d1 execute challanse-pilot --local --persist-to "$STATE" --config "$CONFIG" --command "SELECT r.image_deleted_at, s.stored_image_bytes FROM receipts r JOIN sites s ON s.id=r.site_id WHERE r.id='$RECEIPT_ID';" --json)"
jq -e '.[0].results[0].image_deleted_at != null and .[0].results[0].stored_image_bytes == 0' >/dev/null <<<"$RETENTION_RESULT"

OLD_RECEIPT_ID="0195279a-7f6f-4af8-bc14-28640f0aa99b"
OLD_RECEIPT_SQL="INSERT INTO receipts (id,site_id,device_id,vendor_id,captured_at_unix,captured_quantity,image_key,image_bytes,image_sha256,status,app_version,configuration_version,created_at) VALUES ('$OLD_RECEIPT_ID','site-1',$(printf "'%s'" "$(npx wrangler d1 execute challanse-pilot --local --persist-to "$STATE" --config "$CONFIG" --command "SELECT id FROM devices WHERE site_id='site-1' LIMIT 1;" --json | jq -r '.[0].results[0].id')"),'vendor-1',1800000000,1,'site-1/old.webp',12,'old-hash','RECEIVED','1.0.0',1,datetime('now','-10 minutes'));"
npx wrangler d1 execute challanse-pilot --local --persist-to "$STATE" --config "$CONFIG" --command "$OLD_RECEIPT_SQL" >/dev/null
curl --fail --silent "http://127.0.0.1:$PORT/__scheduled?cron=0+3+*+*+*" >/dev/null
RECOVERY_RESULT="$(npx wrangler d1 execute challanse-pilot --local --persist-to "$STATE" --config "$CONFIG" --command "SELECT r.status, COUNT(a.id) AS audit_count FROM receipts r LEFT JOIN receipt_audits a ON a.receipt_id=r.id AND a.actor='reconciliation' WHERE r.id='$OLD_RECEIPT_ID' GROUP BY r.status;" --json)"
jq -e '.[0].results[0].status == "NEEDS_REVIEW" and .[0].results[0].audit_count == 1' >/dev/null <<<"$RECOVERY_RESULT"

echo "Edge integration checks passed."
