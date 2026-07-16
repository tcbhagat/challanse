from functools import lru_cache
from typing import Protocol

from celery import Celery

from .config import get_settings
from .schemas import ReceiptEvent


class EventQueue(Protocol):
    def enqueue(self, event: ReceiptEvent) -> str: ...


class DisabledEventQueue:
    def enqueue(self, event: ReceiptEvent) -> str:
        raise RuntimeError("event_queue_disabled")


class MemoryEventQueue:
    def __init__(self) -> None:
        self.events: list[ReceiptEvent] = []

    def enqueue(self, event: ReceiptEvent) -> str:
        self.events.append(event)
        return event.receipt_id


class CeleryEventQueue:
    def __init__(self, broker_url: str) -> None:
        self.client = Celery("challanse-enrichment-client", broker=broker_url)

    def enqueue(self, event: ReceiptEvent) -> str:
        result = self.client.send_task(
            "challanse.process_receipt",
            kwargs={"event_payload": event.model_dump(mode="json")},
            task_id=f"receipt-{event.receipt_id}",
        )
        return str(result.id)


@lru_cache(maxsize=1)
def get_event_queue() -> EventQueue:
    settings = get_settings()
    if settings.event_queue_provider == "memory":
        return MemoryEventQueue()
    if settings.event_queue_provider == "celery":
        return CeleryEventQueue(settings.redis_url)
    return DisabledEventQueue()
