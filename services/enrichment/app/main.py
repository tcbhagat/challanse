import logging

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status

from .config import get_settings
from .queueing import EventQueue, get_event_queue
from .schemas import ReceiptEvent
from .security import verify_service_request


logger = logging.getLogger("challanse.enrichment")
app = FastAPI(title="ChallanSe Enrichment", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/events/receipts", status_code=status.HTTP_202_ACCEPTED)
async def receipt_event(
    request: Request,
    x_challanse_signature: str = Header(default=""),
    x_challanse_timestamp: str = Header(default=""),
    x_challanse_request_id: str = Header(default=""),
    settings=Depends(get_settings),
    event_queue: EventQueue = Depends(get_event_queue),
) -> dict[str, str]:
    raw = await request.body()
    if not verify_service_request(
        settings.cloudflare_shared_secret,
        raw,
        x_challanse_signature,
        x_challanse_timestamp,
        x_challanse_request_id,
    ):
        raise HTTPException(status_code=401, detail="invalid_service_signature")
    event = ReceiptEvent.model_validate_json(raw)
    try:
        task_id = event_queue.enqueue(event)
    except Exception as error:
        logger.error("receipt_event_queue_failed receipt_id=%s error=%s", event.receipt_id, type(error).__name__)
        raise HTTPException(status_code=503, detail="event_queue_unavailable") from error
    logger.info("receipt_event_accepted receipt_id=%s site_id=%s", event.receipt_id, event.site_id)
    return {"status": "accepted", "receipt_id": event.receipt_id, "task_id": task_id}
