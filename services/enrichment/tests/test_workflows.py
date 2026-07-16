import time

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.gst import quantities_match, validate_gst
from app.main import app
from app.notifications import DigestReceipt, aggregate_digests
from app.queueing import MemoryEventQueue, get_event_queue
from app.providers import MemoryCreditQueue
from app.reconciliation import delta_rows, parse_tally_csv
from app.schemas import GstReceiptContext
from app.security import sign_payload
from app.telemetry import SiteMetric, threshold_alerts


class FakeResponse:
    status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return {"IRN_Hash": "irn-001", "e_invoice_quantity": 110.0}


class FakeHttpClient:
    def post(self, *args, **kwargs) -> FakeResponse:
        assert kwargs["timeout"] == 3.0
        return FakeResponse()


def test_ten_percent_mismatch_blocks_credit_queue() -> None:
    settings = Settings(GST_PROVIDER="http", GST_TIMEOUT_SECONDS=3.0)
    queue = MemoryCreditQueue()
    status, audit = validate_gst(
        settings,
        GstReceiptContext(
            receipt_id="receipt-001",
            vendor_gst_number="27ABCDE1234F1Z5",
            timestamp_unix=1_700_000_000,
            site_captured_quantity=100.0,
            material_description="cement",
            site_geo_hash="site-hash",
        ),
        queue,
        FakeHttpClient(),
    )
    assert status == "GST_ANOMALY"
    assert audit["irn_hash"] == "irn-001"
    assert queue.payloads == []


def test_tolerance_boundaries() -> None:
    assert quantities_match(100.0, 102.0)
    assert quantities_match(100.0, 98.0)
    assert not quantities_match(100.0, 102.01)


def test_signed_event_contract() -> None:
    secret = "test-secret"
    get_settings.cache_clear()
    app.dependency_overrides[get_settings] = lambda: Settings(CLOUDFLARE_SHARED_SECRET=secret)
    event_queue = MemoryEventQueue()
    app.dependency_overrides[get_event_queue] = lambda: event_queue
    body = b'{"receipt_id":"11111111-1111-1111-1111-111111111111","site_id":"22222222-2222-2222-2222-222222222222","image_key":"site/image.webp","vendor_id":"vendor-1","captured_at_unix":1700000000,"site_captured_quantity":100,"schema_version":"1.0"}'
    timestamp = str(int(time.time()))
    request_id = "request-001"
    signature = sign_payload(secret, f"{timestamp}.{request_id}.".encode("utf-8") + body)
    client = TestClient(app)
    response = client.post("/v1/events/receipts", content=body, headers={
        "X-ChallanSe-Signature": signature,
        "X-ChallanSe-Timestamp": timestamp,
        "X-ChallanSe-Request-Id": request_id,
        "Content-Type": "application/json",
    })
    app.dependency_overrides.clear()
    assert response.status_code == 202
    assert [event.receipt_id for event in event_queue.events] == ["11111111-1111-1111-1111-111111111111"]


def test_digest_is_grouped_and_never_per_receipt() -> None:
    digests = aggregate_digests([DigestReceipt("pm-1", False), DigestReceipt("pm-1", True)], "https://review.example")
    assert list(digests) == ["pm-1"]
    assert "2 receipts scanned. 1 failed to read" in digests["pm-1"]


def test_tally_delta_highlights_over_receipt() -> None:
    rows = parse_tally_csv("po_number,material_code,quantity,unit\nPO-1,CEM,100,BAG\n")
    result = delta_rows({("PO-1", "CEM", "BAG"): 110.0}, rows)
    assert result[0]["is_over"] is True


def test_telemetry_thresholds() -> None:
    alerts = threshold_alerts([SiteMetric("site-1", 101)], [SiteMetric("site-1", 0.21)], [SiteMetric("vendor-1", 69)])
    assert len(alerts) == 3
