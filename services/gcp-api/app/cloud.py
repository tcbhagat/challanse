from datetime import UTC, datetime, timedelta
from functools import cached_property

import google.auth
from google.auth.transport.requests import AuthorizedSession, Request as AuthRequest
from google.cloud import storage, tasks_v2

from .config import settings

MAX_UPLOAD_BYTES = 5_000_000


class ObjectStore:
    def __init__(self):
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        self.credentials = credentials
        self.client = storage.Client(project=settings.project_id, credentials=credentials)

    def _signing_options(self) -> dict[str, str]:
        self.credentials.refresh(AuthRequest())
        service_account_email = getattr(self.credentials, "service_account_email", "")
        access_token = getattr(self.credentials, "token", "")
        if not service_account_email or service_account_email == "default" or not access_token:
            raise RuntimeError("IAM signing credentials unavailable")
        return {
            "service_account_email": service_account_email,
            "access_token": access_token,
        }

    def signed_upload(self, object_name: str, mime_type: str, _size: int) -> str:
        return self.client.bucket(settings.upload_bucket).blob(object_name).generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=15),
            method="PUT",
            content_type=mime_type,
            **self._signing_options(),
        )

    def read_upload(self, object_name: str, expected_size: int) -> bytes:
        blob = self.client.bucket(settings.upload_bucket).blob(object_name)
        blob.reload()
        stored_size = int(blob.size or 0)
        if stored_size != expected_size or stored_size > MAX_UPLOAD_BYTES:
            raise ValueError("UPLOAD_SIZE_MISMATCH")
        return blob.download_as_bytes(if_generation_match=blob.generation)

    def accept(self, object_name: str, data: bytes, mime_type: str) -> str:
        self.client.bucket(settings.accepted_bucket).blob(object_name).upload_from_string(
            data,
            content_type=mime_type,
            if_generation_match=0,
        )
        return object_name

    def read_accepted(self, object_name: str) -> bytes:
        return self.client.bucket(settings.accepted_bucket).blob(object_name).download_as_bytes()

    def signed_read(self, object_name: str) -> str:
        return self.client.bucket(settings.accepted_bucket).blob(object_name).generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=5),
            method="GET",
            response_disposition="inline",
            **self._signing_options(),
        )

    def delete_upload(self, object_name: str) -> None:
        self.client.bucket(settings.upload_bucket).blob(object_name).delete()

    def delete_accepted(self, object_name: str) -> None:
        self.client.bucket(settings.accepted_bucket).blob(object_name).delete()


class TaskQueue:
    @cached_property
    def client(self) -> tasks_v2.CloudTasksClient:
        return tasks_v2.CloudTasksClient()

    def enqueue_ocr(self, invoice_id: str) -> None:
        parent = self.client.queue_path(
            settings.project_id, settings.task_location, settings.task_queue
        )
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{settings.task_worker_url}/internal/tasks/ocr/{invoice_id}",
                "headers": {"Content-Type": "application/json"},
                "oidc_token": {
                    "service_account_email": settings.task_service_account
                },
                "body": b"{}",
            }
        }
        self.client.create_task(parent=parent, task=task)


class BackupExporter:
    def __init__(self):
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/datastore"]
        )
        self.session = AuthorizedSession(credentials)

    def start(self) -> str:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        database = f"projects/{settings.project_id}/databases/(default)"
        response = self.session.post(
            f"https://firestore.googleapis.com/v1/{database}:exportDocuments",
            json={
                "outputUriPrefix": (
                    f"gs://{settings.backup_bucket}/firestore/{timestamp}"
                )
            },
            timeout=30,
        )
        response.raise_for_status()
        operation = response.json().get("name", "")
        if not operation:
            raise RuntimeError("Firestore export operation missing")
        return operation
