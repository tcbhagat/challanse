from types import SimpleNamespace

import pytest

from app.cloud import MAX_UPLOAD_BYTES, ObjectStore


class FakeBlob:
    def __init__(self, size: int):
        self.size = size
        self.generation = 7
        self.downloaded = False

    def reload(self):
        return None

    def download_as_bytes(self, **options):
        self.downloaded = True
        assert options == {"if_generation_match": 7}
        return b"image"


class FakeClient:
    def __init__(self, blob):
        self.blob = blob

    def bucket(self, _name):
        return SimpleNamespace(blob=lambda _object_name: self.blob)


def object_store(blob):
    store = ObjectStore.__new__(ObjectStore)
    store.client = FakeClient(blob)
    return store


def test_upload_size_is_checked_before_download():
    blob = FakeBlob(MAX_UPLOAD_BYTES + 1)
    with pytest.raises(ValueError, match="UPLOAD_SIZE_MISMATCH"):
        object_store(blob).read_upload("quarantine/object", MAX_UPLOAD_BYTES)
    assert not blob.downloaded


def test_upload_size_must_match_reserved_size():
    blob = FakeBlob(101)
    with pytest.raises(ValueError, match="UPLOAD_SIZE_MISMATCH"):
        object_store(blob).read_upload("quarantine/object", 100)
    assert not blob.downloaded


def test_upload_download_is_generation_bound_after_size_check():
    blob = FakeBlob(100)
    assert object_store(blob).read_upload("quarantine/object", 100) == b"image"
    assert blob.downloaded


def test_iam_signing_requires_service_account_identity(monkeypatch):
    store = ObjectStore.__new__(ObjectStore)
    store.credentials = SimpleNamespace(
        refresh=lambda _request: None,
        service_account_email="challanse-api@example.iam.gserviceaccount.com",
        token="access-token",
    )
    assert store._signing_options() == {
        "service_account_email": "challanse-api@example.iam.gserviceaccount.com",
        "access_token": "access-token",
    }

