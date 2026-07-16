from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from .config import Settings


@dataclass(frozen=True)
class OcrResult:
    raw_json: dict[str, Any]
    raw_text: str
    confidence: float


@dataclass(frozen=True)
class GstResult:
    irn_hash: str
    e_invoice_quantity: float


class CreditQueue(Protocol):
    def enqueue(self, payload: dict[str, Any]) -> str: ...


class DisabledCreditQueue:
    def enqueue(self, payload: dict[str, Any]) -> str:
        raise RuntimeError("credit_provider_disabled")


class MemoryCreditQueue:
    def __init__(self) -> None:
        self.payloads: list[dict[str, Any]] = []

    def enqueue(self, payload: dict[str, Any]) -> str:
        self.payloads.append(payload)
        return f"mock-{len(self.payloads)}"


def run_ocr(settings: Settings, image_bytes: bytes) -> OcrResult:
    if settings.ocr_provider == "disabled":
        return OcrResult(raw_json={"provider": "disabled"}, raw_text="", confidence=0.0)
    if settings.ocr_provider == "mock":
        return OcrResult(raw_json={"provider": "mock", "blocks": []}, raw_text="Synthetic challan", confidence=95.0)
    raise RuntimeError("textract_requires_aws_runtime_adapter")


def fetch_gst(settings: Settings, vendor_gst_number: str, timestamp_unix: int, client: httpx.Client | None = None) -> GstResult:
    if settings.gst_provider == "disabled":
        raise RuntimeError("gst_provider_disabled")
    if settings.gst_provider == "mock":
        raise RuntimeError("mock_gst_requires_test_fixture")
    owned_client = client is None
    http_client = client or httpx.Client(timeout=settings.gst_timeout_seconds)
    try:
        response = http_client.post(
            settings.gst_api_url,
            json={"vendor_gst_number": vendor_gst_number, "timestamp_unix": timestamp_unix},
            timeout=settings.gst_timeout_seconds,
        )
        response.raise_for_status()
        body = response.json()
        return GstResult(irn_hash=str(body["IRN_Hash"]), e_invoice_quantity=float(body["e_invoice_quantity"]))
    finally:
        if owned_client:
            http_client.close()
