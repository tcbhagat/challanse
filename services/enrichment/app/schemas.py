from typing import Any, Literal

from pydantic import BaseModel, Field


class ReceiptEvent(BaseModel):
    receipt_id: str
    site_id: str
    image_key: str
    vendor_id: str
    captured_at_unix: int
    site_captured_quantity: float
    schema_version: Literal["1.0"] = "1.0"


class AAFIData(BaseModel):
    schema_version: Literal["AA_1.0.0"] = "AA_1.0.0"
    msme_udyam_number: str | None = None
    recipient_bank_account: str | None = None
    developer_gst_number: str
    irn_hash: str
    material_description: str
    verified_quantity: float
    site_geo_hash: str
    timestamp_iso8601: str
    cryptographic_signature: str


class EnrichmentResult(BaseModel):
    receipt_id: str
    status: Literal["READY_FOR_REVIEW", "NEEDS_HUMAN_REVIEW", "VERIFIED_GST", "GST_ANOMALY"]
    ocr_confidence: float | None = None
    raw_ocr_json: dict[str, Any] = Field(default_factory=dict)
    gst_status: str = "NOT_CHECKED"
    version: int = 1


class GstReceiptContext(BaseModel):
    receipt_id: str
    vendor_gst_number: str | None = None
    timestamp_unix: int
    site_captured_quantity: float | None = None
    material_description: str = ""
    site_geo_hash: str = ""
    msme_udyam_number: str | None = None
    recipient_bank_account: str | None = None
