import base64
import json
from typing import Any

import boto3

from .config import Settings


def object_store_client(settings: Settings, client: Any = None) -> Any:
    if client is not None:
        return client
    options: dict[str, Any] = {"region_name": settings.aws_region}
    if settings.object_store_endpoint:
        options.update(
            endpoint_url=settings.object_store_endpoint,
            aws_access_key_id=settings.object_store_access_key,
            aws_secret_access_key=settings.object_store_secret_key,
        )
    return boto3.client("s3", **options)


def object_encryption_headers(settings: Settings, key: str, metadata: dict[str, str]) -> dict[str, str]:
    if settings.object_store_sse_mode == "none":
        return {}
    encryption_context = {
        "organization_id": metadata.get("organization-id", "unknown"),
        "site_id": metadata.get("site-id", "unknown"),
        "object_key": key,
    }
    return {
        "ServerSideEncryption": "aws:kms",
        "SSEKMSKeyId": settings.kms_key_arn,
        "SSEKMSEncryptionContext": base64.b64encode(
            json.dumps(encryption_context, separators=(",", ":")).encode()
        ).decode(),
    }
