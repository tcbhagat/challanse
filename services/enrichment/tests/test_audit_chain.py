from app.audit_chain import audit_event_hash


def test_audit_hash_is_canonical_and_chained() -> None:
    first = audit_event_hash("", {"b": 2, "a": 1})
    assert first == audit_event_hash("", {"a": 1, "b": 2})
    assert audit_event_hash(first, {"event": "SECOND"}) != audit_event_hash("", {"event": "SECOND"})
