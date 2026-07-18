from collections import namedtuple

import pytest

from app.config import Settings
from app.local_ocr import normalize_text, run_local_ocr, validate_normalized
from app.local_storage import local_uploads_paused
from app.object_store import object_encryption_headers
from app.providers import run_ocr


def test_local_object_store_omits_cloud_kms_headers() -> None:
    settings = Settings(OBJECT_STORE_SSE_MODE="none")
    assert object_encryption_headers(settings, "tenant/site/receipt.webp", {"organization-id": "tenant"}) == {}


def test_production_object_store_keeps_kms_context() -> None:
    settings = Settings(KMS_KEY_ARN="arn:aws:kms:ap-south-1:111122223333:key/test")
    headers = object_encryption_headers(
        settings,
        "tenant/site/receipt.webp",
        {"organization-id": "tenant", "site-id": "site"},
    )
    assert headers["ServerSideEncryption"] == "aws:kms"
    assert headers["SSEKMSKeyId"] == settings.kms_key_arn
    assert "SSEKMSEncryptionContext" in headers


def test_normalizer_rejects_untraceable_values() -> None:
    normalized, warnings = validate_normalized(
        {
            "vendor": "Invented Vendor",
            "challan_number": "CH-1001",
            "material": "OPC Cement",
            "quantity": 250,
            "unit": "BAG",
        },
        "CH-1001 OPC Cement 25 BAG",
    )
    assert normalized == {
        "vendor": None,
        "challan_number": "CH-1001",
        "material": "OPC Cement",
        "quantity": None,
        "unit": "BAG",
    }
    assert warnings == ["vendor_untraceable", "quantity_untraceable"]


def test_ollama_receives_only_ocr_text_and_schema() -> None:
    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return {
                "model": "qwen2.5:7b",
                "response": '{"vendor":"Vendor One","challan_number":"CH-9","material":"Steel","quantity":12,"unit":"KG"}',
            }

    class Client:
        def post(self, url, **kwargs):
            assert url.endswith("/api/generate")
            assert "image" not in kwargs["json"]
            assert kwargs["json"]["format"]["additionalProperties"] is False
            assert "Vendor One CH-9 Steel 12 KG" in kwargs["json"]["prompt"]
            return Response()

    normalized, model, warnings = normalize_text(
        Settings(OLLAMA_MODEL="qwen2.5:7b"),
        "Vendor One CH-9 Steel 12 KG",
        Client(),
    )
    assert normalized["quantity"] == 12.0
    assert model == "qwen2.5:7b"
    assert warnings == []


def test_ollama_failure_preserves_ocr_and_forces_review(monkeypatch) -> None:
    from app import local_ocr

    monkeypatch.setattr(local_ocr, "extract_text", lambda *_args: ("Vendor One CH-9 Steel 12 KG", 91.0, "tesseract 5"))

    class Client:
        def post(self, *_args, **_kwargs):
            raise TimeoutError("synthetic timeout")

    result = run_local_ocr(Settings(), b"png", Client())
    assert result.raw_text == "Vendor One CH-9 Steel 12 KG"
    assert result.confidence == 59.0
    assert result.normalized["vendor"] is None
    assert result.warnings == ["ollama_TimeoutError"]


def test_provider_marks_local_invalid_normalization_for_review(monkeypatch) -> None:
    from app import local_ocr

    monkeypatch.setattr(local_ocr, "extract_text", lambda *_args: ("CH-9 Steel 12 KG", 88.0, "tesseract 5"))

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return {"model": "qwen2.5:7b", "response": '{"vendor":"Invented"}'}

    class Client:
        def post(self, *_args, **_kwargs):
            return Response()

    result = run_ocr(Settings(OCR_PROVIDER="local"), b"png", Client())
    assert result.confidence == 59.0
    assert result.raw_json["warnings"] == ["normalization_schema_invalid"]


def test_local_uploads_pause_at_ninety_percent(monkeypatch, tmp_path) -> None:
    DiskUsage = namedtuple("usage", "total used free")
    monkeypatch.setattr("app.local_storage.shutil.disk_usage", lambda _path: DiskUsage(1000, 900, 100))
    settings = Settings(SYNTHETIC_MODE=True, LOCAL_DATA_ROOT=str(tmp_path), LOCAL_STORAGE_LIMIT_BYTES=1000)
    assert local_uploads_paused(settings) is True


def test_production_configuration_rejects_local_providers() -> None:
    settings = Settings(ENVIRONMENT="production", OCR_PROVIDER="local", EVENT_QUEUE_PROVIDER="postgres")
    errors = settings.production_errors()
    assert "EVENT_QUEUE_PROVIDER_must_be_sqs" in errors
    assert "OCR_PROVIDER_must_be_textract" in errors
