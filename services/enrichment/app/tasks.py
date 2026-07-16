from celery import Celery

from .config import get_settings
from .schemas import ReceiptEvent
from .workflow import process_receipt_event


settings = get_settings()
celery_app = Celery("challanse-enrichment", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_default_retry_delay=30,
    task_routes={"challanse.process_receipt": {"queue": "challanse-enrichment"}},
)


@celery_app.task(name="challanse.process_receipt", bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=8)
def process_receipt(self, event_payload: dict[str, object]) -> dict[str, str]:
    event = ReceiptEvent.model_validate(event_payload)
    result = process_receipt_event(settings, event)
    return {"receipt_id": result.receipt_id, "status": result.status}
