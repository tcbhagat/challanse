from typing import Any

from .config import Settings
from .object_store import object_store_client
from .schemas import ReceiptEvent


def delete_all_object_versions(s3: Any, bucket: str, object_key: str) -> None:
    version_marker: str | None = None
    key_marker: str | None = None
    while True:
        request: dict[str, object] = {"Bucket": bucket, "Prefix": object_key}
        if version_marker:
            request["VersionIdMarker"] = version_marker
        if key_marker:
            request["KeyMarker"] = key_marker
        try:
            response = s3.list_object_versions(**request)
        except s3.exceptions.ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code not in {"NotImplemented", "MethodNotAllowed", "XNotImplemented"}:
                raise
            s3.delete_object(Bucket=bucket, Key=object_key)
            return
        objects = [
            {"Key": item["Key"], "VersionId": item["VersionId"]}
            for item in [*response.get("Versions", []), *response.get("DeleteMarkers", [])]
            if item.get("Key") == object_key
        ]
        if objects:
            s3.delete_objects(Bucket=bucket, Delete={"Objects": objects, "Quiet": True})
        if not response.get("IsTruncated"):
            return
        version_marker = response.get("NextVersionIdMarker")
        key_marker = response.get("NextKeyMarker")


def fetch_receipt_image(settings: Settings, event: ReceiptEvent, client: Any = None) -> bytes:
    if not settings.receipt_bucket:
        raise RuntimeError("receipt_bucket_unconfigured")
    expected_prefix = f"{event.organization_id}/{event.site_id}/"
    if not event.image_key.startswith(expected_prefix) or not event.image_key.endswith(f"/{event.receipt_id}.webp"):
        raise RuntimeError("receipt_image_key_scope_invalid")
    s3 = object_store_client(settings, client)
    response = s3.get_object(Bucket=settings.receipt_bucket, Key=event.image_key)
    metadata = response.get("Metadata", {})
    expected_metadata = {
        "organization-id": event.organization_id,
        "site-id": event.site_id,
        "receipt-id": event.receipt_id,
        "sha256": event.image_sha256,
    }
    if any(metadata.get(key) != value for key, value in expected_metadata.items()):
        raise RuntimeError("receipt_image_metadata_invalid")
    if response.get("ContentType") != "image/webp":
        raise RuntimeError("receipt_image_content_type_invalid")
    return bytes(response["Body"].read())
