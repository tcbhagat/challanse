from datetime import UTC, datetime, timedelta

import pytest

from app import store as store_module
from app.store import FirestoreStore


class Snapshot:
    def __init__(self, data):
        self.data = data
        self.exists = data is not None

    def to_dict(self):
        return None if self.data is None else dict(self.data)


class Reference:
    def __init__(self, database, collection, document):
        self.database = database
        self.collection = collection
        self.document = document

    @property
    def key(self):
        return self.collection, self.document

    def get(self, transaction=None):
        return Snapshot(self.database.data.get(self.key))

    def update(self, values):
        self.database.data[self.key].update(values)

    def set(self, values, merge=False):
        if merge:
            self.database.data.setdefault(self.key, {}).update(values)
        else:
            self.database.data[self.key] = dict(values)


class Collection:
    def __init__(self, database, name):
        self.database = database
        self.name = name

    def document(self, document=None):
        if document is None:
            self.database.sequence += 1
            document = f"generated-{self.database.sequence}"
        return Reference(self.database, self.name, document)


class Transaction:
    def create(self, reference, values):
        if reference.key in reference.database.data:
            raise RuntimeError("already exists")
        reference.database.data[reference.key] = dict(values)

    def set(self, reference, values, merge=False):
        reference.set(values, merge=merge)

    def update(self, reference, values):
        reference.update(values)


class Database:
    def __init__(self, data=None):
        self.data = data or {}
        self.sequence = 0

    def collection(self, name):
        return Collection(self, name)

    def transaction(self):
        return Transaction()


@pytest.fixture(autouse=True)
def direct_transactions(monkeypatch):
    monkeypatch.setattr(store_module.firestore, "transactional", lambda function: function)


def make_store(data):
    instance = FirestoreStore.__new__(FirestoreStore)
    instance.db = Database(data)
    return instance


def test_late_ocr_cannot_resurrect_deleted_invoice():
    instance = make_store({("invoices", "invoice-1"): {"state": "DELETED"}})
    assert not instance.mark_ocr("invoice-1", {"vendor": "Vendor"}, "ok")
    assert instance.db.data[("invoices", "invoice-1")]["state"] == "DELETED"


def test_ocr_updates_only_processable_invoice():
    instance = make_store({("invoices", "invoice-1"): {"state": "PROCESSING"}})
    assert instance.mark_ocr("invoice-1", {"vendor": "Vendor"}, "ok")
    assert instance.db.data[("invoices", "invoice-1")]["state"] == "READY_TO_CONFIRM"


def test_billing_event_and_entitlement_update_are_atomic_and_idempotent():
    instance = make_store({})
    payload = {
        "event": "subscription.activated",
        "payload": {
            "subscription": {
                "entity": {
                    "id": "sub_1",
                    "status": "active",
                    "current_end": 1_800_000_000,
                    "notes": {"firebase_uid": "user-1"},
                }
            }
        },
    }
    assert instance.apply_billing_event("event-1", payload)
    assert instance.db.data[("users", "user-1")]["plan"] == "PAID"
    assert not instance.apply_billing_event("event-1", payload)


def test_second_checkout_is_rejected_while_first_is_pending():
    instance = make_store({("users", "user-1"): {"plan": "FREE"}})
    instance.reserve_checkout("user-1", "request-1")
    with pytest.raises(ValueError, match="CHECKOUT_PENDING"):
        instance.reserve_checkout("user-1", "request-2")


def test_support_grant_rejects_expired_token():
    expired = datetime.now(UTC) - timedelta(minutes=1)
    instance = make_store({("support_grants", "grant-1"): {"uid": "user-1", "expiresAt": expired, "revokedAt": None}})
    with pytest.raises(PermissionError, match="SUPPORT_GRANT_INVALID"):
        instance.authorize_support_grant("grant-1", "invoice-1")
