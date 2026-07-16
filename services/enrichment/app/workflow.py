import logging

from .cloudflare import fetch_private_image, send_callback
from .config import Settings
from .exif import extract_gps
from .providers import run_ocr
from .schemas import EnrichmentResult, ReceiptEvent
from .storage import upsert_enrichment


logger = logging.getLogger("challanse.enrichment.workflow")


def process_receipt_event(settings: Settings, event: ReceiptEvent) -> EnrichmentResult:
    image_bytes = fetch_private_image(settings, event.receipt_id)
    gps_latitude, gps_longitude = extract_gps(image_bytes)
    ocr = run_ocr(settings, image_bytes)
    status = "READY_FOR_REVIEW" if ocr.confidence >= 60 else "NEEDS_HUMAN_REVIEW"
    version = upsert_enrichment(
        settings.database_url,
        event,
        status,
        ocr.raw_json,
        ocr.raw_text,
        ocr.confidence,
        gps_latitude,
        gps_longitude,
    )
    result = EnrichmentResult(
        receipt_id=event.receipt_id,
        status=status,
        ocr_confidence=ocr.confidence,
        raw_ocr_json=ocr.raw_json,
        version=version,
    )
    send_callback(settings, result)
    logger.info(
        "receipt_enriched receipt_id=%s site_id=%s status=%s confidence=%.1f gps_present=%s",
        event.receipt_id,
        event.site_id,
        status,
        ocr.confidence,
        gps_latitude is not None,
    )
    return result
