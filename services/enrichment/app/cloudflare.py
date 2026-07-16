import json
import time
from uuid import uuid4

import httpx

from .config import Settings
from .schemas import EnrichmentResult
from .security import sign_payload


def fetch_private_image(settings: Settings, receipt_id: str, client: httpx.Client | None = None) -> bytes:
    if not settings.cloudflare_api_url or not settings.cloudflare_shared_secret:
        raise RuntimeError("cloudflare_service_auth_unconfigured")
    timestamp = str(int(time.time()))
    signature = sign_payload(settings.cloudflare_shared_secret, f"{receipt_id}:{timestamp}".encode("utf-8"))
    owned_client = client is None
    http_client = client or httpx.Client(timeout=15.0)
    try:
        response = http_client.get(
            f"{settings.cloudflare_api_url.rstrip('/')}/v1/internal/receipts/{receipt_id}/image",
            headers={"X-ChallanSe-Timestamp": timestamp, "X-ChallanSe-Signature": signature},
        )
        response.raise_for_status()
        return response.content
    finally:
        if owned_client:
            http_client.close()


def send_callback(settings: Settings, result: EnrichmentResult, client: httpx.Client | None = None) -> None:
    raw = json.dumps(result.model_dump(mode="json"), separators=(",", ":")).encode("utf-8")
    timestamp = str(int(time.time()))
    request_id = str(uuid4())
    signature = sign_payload(
        settings.cloudflare_shared_secret,
        f"{timestamp}.{request_id}.".encode("utf-8") + raw,
    )
    owned_client = client is None
    http_client = client or httpx.Client(timeout=15.0)
    try:
        response = http_client.post(
            f"{settings.cloudflare_api_url.rstrip('/')}/v1/internal/receipts/{result.receipt_id}/enrichment",
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-ChallanSe-Timestamp": timestamp,
                "X-ChallanSe-Request-Id": request_id,
                "X-ChallanSe-Signature": signature,
            },
        )
        response.raise_for_status()
    finally:
        if owned_client:
            http_client.close()
