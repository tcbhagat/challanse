from datetime import timedelta
from functools import cached_property
from google.cloud import storage, tasks_v2
from google.protobuf import timestamp_pb2
from .config import settings

class ObjectStore:
    def __init__(self): self.client = storage.Client(project=settings.project_id)
    def signed_upload(self, object_name: str, mime_type: str, size: int) -> str:
        return self.client.bucket(settings.upload_bucket).blob(object_name).generate_signed_url(version="v4", expiration=timedelta(minutes=15), method="PUT", content_type=mime_type)
    def read_upload(self, object_name: str) -> bytes: return self.client.bucket(settings.upload_bucket).blob(object_name).download_as_bytes()
    def accept(self, object_name: str, data: bytes, mime_type: str) -> str:
        self.client.bucket(settings.accepted_bucket).blob(object_name).upload_from_string(data, content_type=mime_type, if_generation_match=0); return object_name
    def read_accepted(self, object_name: str) -> bytes: return self.client.bucket(settings.accepted_bucket).blob(object_name).download_as_bytes()
    def signed_read(self, object_name: str) -> str: return self.client.bucket(settings.accepted_bucket).blob(object_name).generate_signed_url(version="v4", expiration=timedelta(minutes=5), method="GET", response_disposition="inline")
    def delete_upload(self, object_name: str) -> None: self.client.bucket(settings.upload_bucket).blob(object_name).delete()
    def delete_accepted(self, object_name: str) -> None: self.client.bucket(settings.accepted_bucket).blob(object_name).delete()

class TaskQueue:
    @cached_property
    def client(self) -> tasks_v2.CloudTasksClient:
        return tasks_v2.CloudTasksClient()
    def enqueue_ocr(self, invoice_id: str) -> None:
        parent = self.client.queue_path(settings.project_id, settings.task_location, settings.task_queue)
        task = {"http_request": {"http_method": tasks_v2.HttpMethod.POST, "url": f"{settings.task_worker_url}/internal/tasks/ocr/{invoice_id}", "headers": {"Content-Type": "application/json"}, "oidc_token": {"service_account_email": settings.task_service_account}, "body": b"{}"}}
        self.client.create_task(parent=parent, task=task)
