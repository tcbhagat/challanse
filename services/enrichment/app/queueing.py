import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol
from uuid import UUID, uuid4

import boto3
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import get_settings
from .schemas import ReceiptEvent
from .tenancy import system_connection


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


class SqsEventQueue:
    def __init__(self, queue_url: str, region: str, client=None) -> None:
        if not queue_url:
            raise RuntimeError("receipt_queue_url_unconfigured")
        self.queue_url = queue_url
        self.client = client or boto3.client("sqs", region_name=region)

    def enqueue(self, event: ReceiptEvent) -> str:
        response = self.client.send_message(
            QueueUrl=self.queue_url,
            MessageBody=json.dumps(event.model_dump(mode="json"), separators=(",", ":")),
            MessageAttributes={
                "schema_version": {"DataType": "String", "StringValue": event.schema_version},
                "receipt_id": {"DataType": "String", "StringValue": event.receipt_id},
                "organization_id": {"DataType": "String", "StringValue": event.organization_id},
                "site_id": {"DataType": "String", "StringValue": event.site_id},
            },
        )
        message_id = response.get("MessageId")
        if not message_id:
            raise RuntimeError("sqs_message_id_missing")
        return str(message_id)


class PostgresEventQueue:
    def __init__(self, database_url: str) -> None:
        if not database_url:
            raise RuntimeError("database_url_unconfigured")
        self.database_url = database_url

    def enqueue(self, event: ReceiptEvent) -> str:
        message_id = uuid4()
        with system_connection(self.database_url) as connection:
            row = connection.execute(
                """
                INSERT INTO local_receipt_queue
                  (id, organization_id, receipt_id, payload_json)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (organization_id, receipt_id) DO UPDATE
                  SET payload_json = excluded.payload_json, updated_at = NOW()
                RETURNING id
                """,
                (message_id, event.organization_id, event.receipt_id, Jsonb(event.model_dump(mode="json"))),
            ).fetchone()
            connection.commit()
        if row is None:
            raise RuntimeError("local_queue_message_id_missing")
        return str(row[0])


@dataclass(frozen=True)
class LocalQueueMessage:
    id: UUID
    event: ReceiptEvent
    attempts: int


def claim_local_message(database_url: str) -> LocalQueueMessage | None:
    with system_connection(database_url, row_factory=dict_row) as connection:
        row = connection.execute(
            """
            WITH candidate AS (
              SELECT id FROM local_receipt_queue
              WHERE ((status IN ('PENDING', 'FAILED_RETRYABLE') AND available_at <= NOW())
                 OR (status = 'PROCESSING' AND locked_until < NOW()))
              ORDER BY created_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE local_receipt_queue AS queue
            SET status = 'PROCESSING', attempts = attempts + 1,
                locked_until = NOW() + INTERVAL '3 minutes', updated_at = NOW()
            FROM candidate
            WHERE queue.id = candidate.id
            RETURNING queue.id, queue.payload_json, queue.attempts
            """
        ).fetchone()
        connection.commit()
    if row is None:
        return None
    return LocalQueueMessage(
        id=UUID(str(row["id"])),
        event=ReceiptEvent.model_validate(row["payload_json"]),
        attempts=int(row["attempts"]),
    )


def complete_local_message(database_url: str, message: LocalQueueMessage) -> None:
    with system_connection(database_url) as connection:
        connection.execute(
            """
            UPDATE local_receipt_queue
            SET status = 'DELIVERED', delivered_at = NOW(), locked_until = NULL, updated_at = NOW()
            WHERE id = %s AND status = 'PROCESSING'
            """,
            (message.id,),
        )
        connection.commit()


def fail_local_message(database_url: str, message: LocalQueueMessage, error_code: str) -> None:
    terminal = message.attempts >= 10
    with system_connection(database_url) as connection:
        connection.execute(
            """
            UPDATE local_receipt_queue
            SET status = %s, last_error_code = %s, locked_until = NULL,
                available_at = NOW() + (LEAST(300, POWER(2, LEAST(attempts, 8))) * INTERVAL '1 second'),
                updated_at = NOW()
            WHERE id = %s AND status = 'PROCESSING'
            """,
            ("FAILED_TERMINAL" if terminal else "FAILED_RETRYABLE", error_code[:120], message.id),
        )
        connection.commit()


@lru_cache(maxsize=1)
def get_event_queue() -> EventQueue:
    settings = get_settings()
    if settings.event_queue_provider == "memory":
        return MemoryEventQueue()
    if settings.event_queue_provider == "sqs":
        return SqsEventQueue(settings.receipt_queue_url, settings.aws_region)
    if settings.event_queue_provider == "postgres":
        return PostgresEventQueue(settings.system_database_url or settings.database_url)
    return DisabledEventQueue()
