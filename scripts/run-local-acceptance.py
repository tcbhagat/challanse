#!/usr/bin/env python3
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4


def request_json(
    context: ssl.SSLContext,
    base_url: str,
    path: str,
    method: str = "GET",
    payload: dict | bytes | None = None,
    headers: dict[str, str] | None = None,
) -> dict:
    body = None
    request_headers = dict(headers or {})
    if isinstance(payload, dict):
        body = json.dumps(payload, separators=(",", ":")).encode()
        request_headers["Content-Type"] = "application/json"
    elif isinstance(payload, bytes):
        body = payload
    request = urllib.request.Request(f"{base_url}{path}", data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, context=context, timeout=30) as response:
            content = response.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code} for {method} {path}: {error.read().decode(errors='replace')[:300]}") from error


def nonce_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-ChallanSe-Device-Timestamp": str(int(time.time())),
        "X-ChallanSe-Nonce": uuid4().hex,
    }


def main() -> int:
    base_url = os.environ["LOCAL_API_BASE_URL"].rstrip("/")
    enrollment_code = os.environ["LOCAL_ENROLLMENT_CODE"]
    fixture_dir = Path(os.environ["LOCAL_FIXTURE_DIR"])
    output_path = Path(os.environ["LOCAL_ACCEPTANCE_OUTPUT"])
    context = ssl.create_default_context(cafile=os.environ["LOCAL_CA_FILE"])
    enrolled = request_json(
        context,
        base_url,
        "/v1/devices/enroll",
        "POST",
        {"enrollmentCode": enrollment_code, "deviceName": "Acceptance Device", "appVersion": "local-acceptance-1"},
    )
    token = str(enrolled["deviceToken"])
    bootstrap = request_json(
        context,
        base_url,
        "/v1/mobile/bootstrap",
        headers={"Authorization": f"Bearer {token}"},
    )
    vendors = [str(vendor["id"]) for vendor in bootstrap["vendors"]]
    fixtures = sorted(fixture_dir.glob("*.webp"))
    if len(fixtures) != 5 or len(vendors) != 4:
        raise RuntimeError("synthetic_fixture_or_vendor_count_invalid")
    acknowledgements = []
    started_at = time.monotonic()
    for index in range(50):
        image = fixtures[index % len(fixtures)].read_bytes()
        digest = hashlib.sha256(image).hexdigest()
        receipt_id = str(uuid4())
        create_payload = {
            "receiptId": receipt_id,
            "vendorId": vendors[index % len(vendors)],
            "capturedAtUnix": int(time.time()),
            "capturedQuantity": float((index % 20) + 1),
            "imageSha256": digest,
            "appVersion": "local-acceptance-1",
            "configurationVersion": int(bootstrap["configurationVersion"]),
            "totalBytes": len(image),
            "mimeType": "image/webp",
        }
        session = request_json(context, base_url, "/v1/uploads", "POST", create_payload, nonce_headers(token))
        upload_id = str(session["uploadId"])
        part_size = int(session["partSize"])
        for part_number, offset in enumerate(range(0, len(image), part_size)):
            part = image[offset:offset + part_size]
            request_json(
                context,
                base_url,
                f"/v1/uploads/{upload_id}/parts/{part_number}",
                "PUT",
                part,
                {**nonce_headers(token), "Content-Type": "application/octet-stream", "X-Part-Sha256": hashlib.sha256(part).hexdigest()},
            )
        acknowledgement_started = time.monotonic()
        completed = request_json(
            context,
            base_url,
            f"/v1/uploads/{upload_id}/complete",
            "POST",
            b"",
            nonce_headers(token),
        )
        acknowledgements.append({
            "receiptId": receipt_id,
            "status": completed["status"],
            "acknowledgementMs": round((time.monotonic() - acknowledgement_started) * 1000, 2),
        })
    deadline = time.monotonic() + 1800
    queue_depth = 50
    while time.monotonic() < deadline:
        local_status = request_json(context, base_url, "/v1/local/status")
        queue_depth = int(local_status["queueDepth"])
        if queue_depth == 0:
            break
        time.sleep(5)
    report = {
        "synthetic": True,
        "receiptCount": len(acknowledgements),
        "uniqueReceiptCount": len({item["receiptId"] for item in acknowledgements}),
        "allAcknowledgedBeforeOcrDrain": all(item["status"] == "RECEIVED" for item in acknowledgements),
        "queueDepthAfterWait": queue_depth,
        "elapsedSeconds": round(time.monotonic() - started_at, 2),
        "maxAcknowledgementMs": max(item["acknowledgementMs"] for item in acknowledgements),
        "passed": len(acknowledgements) == 50 and queue_depth == 0,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
