from typing import Any
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

from .schemas import ReceiptEvent


def upsert_enrichment(
    database_url: str,
    event: ReceiptEvent,
    status: str,
    raw_ocr_json: dict[str, Any],
    raw_text: str,
    confidence: float,
    gps_latitude: float | None,
    gps_longitude: float | None,
) -> int:
    if not database_url:
        raise RuntimeError("database_url_unconfigured")
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO enrichment_receipts (
                  receipt_id, site_id, vendor_id, captured_at_unix, site_captured_quantity,
                  status, raw_ocr_json, raw_text, ocr_confidence, gps_latitude, gps_longitude
                ) VALUES (
                  %(receipt_id)s, %(site_id)s, %(vendor_id)s, %(captured_at_unix)s, %(site_captured_quantity)s,
                  %(status)s, %(raw_ocr_json)s, %(raw_text)s, %(ocr_confidence)s, %(gps_latitude)s, %(gps_longitude)s
                )
                ON CONFLICT (receipt_id) DO UPDATE SET
                  status = excluded.status,
                  raw_ocr_json = excluded.raw_ocr_json,
                  raw_text = excluded.raw_text,
                  ocr_confidence = excluded.ocr_confidence,
                  gps_latitude = excluded.gps_latitude,
                  gps_longitude = excluded.gps_longitude,
                  version = enrichment_receipts.version + 1,
                  updated_at = NOW()
                RETURNING version
                """,
                {
                    **event.model_dump(mode="python"),
                    "status": status,
                    "raw_ocr_json": Jsonb(raw_ocr_json),
                    "raw_text": raw_text,
                    "ocr_confidence": confidence,
                    "gps_latitude": gps_latitude,
                    "gps_longitude": gps_longitude,
                },
            )
            version = int(cursor.fetchone()[0])
            cursor.execute(
                """
                INSERT INTO immutable_enrichment_audits (id, receipt_id, event_type, event_json)
                VALUES (%(audit_id)s, %(receipt_id)s, 'OCR_COMPLETED', %(event_json)s)
                """,
                {
                    "receipt_id": event.receipt_id,
                    "audit_id": uuid4(),
                    "event_json": Jsonb({"status": status, "confidence": confidence, "gps_present": gps_latitude is not None}),
                },
            )
        connection.commit()
    return version
