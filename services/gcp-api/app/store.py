from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo
from google.cloud import firestore
from .config import settings

IST = ZoneInfo("Asia/Kolkata")

def now() -> datetime: return datetime.now(UTC)
def day_key(moment: datetime | None = None) -> str: return (moment or now()).astimezone(IST).date().isoformat()

@dataclass(frozen=True)
class Entitlement:
    plan: str
    daily_limit: int
    retention_days: int

class FirestoreStore:
    def __init__(self, client: firestore.Client | None = None): self.db = client or firestore.Client(project=settings.project_id)

    def entitlement(self, uid: str) -> Entitlement:
        data = (self.db.collection("users").document(uid).get().to_dict() or {})
        paid_until = data.get("paidUntil")
        grace_until = data.get("graceUntil")
        paid = data.get("plan") in {"PAID", "CANCEL_AT_PERIOD_END"} and (not paid_until or paid_until > now())
        grace = data.get("plan") == "PAST_DUE" and grace_until and grace_until > now()
        return Entitlement("PAID" if paid or grace else "FREE", 25 if paid or grace else 3, 90 if paid or grace else 7)

    def usage(self, uid: str) -> int:
        return int((self.db.collection("daily_usage").document(f"{uid}:{day_key()}").get().to_dict() or {}).get("count", 0))

    def has_current_consent(self, uid: str) -> bool:
        data = self.db.collection("users").document(uid).get().to_dict() or {}
        return data.get("consentVersion") == settings.consent_version and data.get("consentedAt") is not None

    def record_consent(self, uid: str, version: str) -> None:
        if version != settings.consent_version: raise ValueError("CONSENT_VERSION_MISMATCH")
        self.db.collection("users").document(uid).set({"consentVersion": version, "consentedAt": now()}, merge=True)
        self.db.collection("audit_events").document().set({"uid": uid, "action": "TERMS_ACCEPTED", "version": version, "timestamp": now()})

    def reserve_upload(self, uid: str, upload_id: str, metadata: dict[str, Any], entitlement: Entitlement) -> None:
        if not self.has_current_consent(uid): raise PermissionError("CONSENT_REQUIRED")
        transaction = self.db.transaction()
        user_ref = self.db.collection("daily_usage").document(f"{uid}:{day_key()}")
        global_ref = self.db.collection("daily_usage").document(f"global:{day_key()}")
        upload_ref = self.db.collection("uploads").document(upload_id)

        @firestore.transactional
        def apply(tx: firestore.Transaction) -> None:
            user_count = int((user_ref.get(transaction=tx).to_dict() or {}).get("count", 0))
            global_count = int((global_ref.get(transaction=tx).to_dict() or {}).get("count", 0))
            control = self.db.collection("system_controls").document("processing").get(transaction=tx).to_dict() or {"open": True}
            if not control.get("open", False): raise ValueError("CAPACITY_REACHED")
            if user_count >= entitlement.daily_limit: raise ValueError("DAILY_LIMIT")
            if global_count >= settings.global_daily_limit: raise ValueError("CAPACITY_REACHED")
            tx.set(upload_ref, {**metadata, "uid": uid, "state": "UPLOADING", "dailyLimit": entitlement.daily_limit, "retentionDays": entitlement.retention_days, "createdAt": now(), "expiresAt": now() + timedelta(hours=1)})
        apply(transaction)

    def finalize_upload(
        self,
        uid: str,
        upload_id: str,
        accepted_object: str,
        entitlement: Entitlement,
    ) -> dict[str, Any]:
        transaction = self.db.transaction()
        upload_ref = self.db.collection("uploads").document(upload_id)
        invoice_ref = self.db.collection("invoices").document(upload_id)
        user_ref = self.db.collection("daily_usage").document(f"{uid}:{day_key()}")
        global_ref = self.db.collection("daily_usage").document(f"global:{day_key()}")
        @firestore.transactional
        def apply(tx: firestore.Transaction) -> dict[str, Any]:
            upload = upload_ref.get(transaction=tx).to_dict()
            if not upload or upload.get("uid") != uid: raise KeyError("UPLOAD_NOT_FOUND")
            existing = invoice_ref.get(transaction=tx).to_dict()
            if existing: return existing
            if upload.get("expiresAt") is None or upload["expiresAt"] <= now():
                raise ValueError("UPLOAD_EXPIRED")
            user_count = int((user_ref.get(transaction=tx).to_dict() or {}).get("count", 0))
            global_count = int((global_ref.get(transaction=tx).to_dict() or {}).get("count", 0))
            if user_count >= entitlement.daily_limit: raise ValueError("DAILY_LIMIT")
            if global_count >= settings.global_daily_limit: raise ValueError("CAPACITY_REACHED")
            document = {"uid": uid, "state": "PROCESSING", "filename": upload["filename"], "createdAt": now(), "expiresAt": now() + timedelta(days=entitlement.retention_days), "version": 1, "fields": {}, "object": accepted_object}
            tx.set(invoice_ref, document); tx.set(user_ref, {"count": user_count + 1, "updatedAt": now()}); tx.set(global_ref, {"count": global_count + 1, "updatedAt": now()}); tx.update(upload_ref, {"state": "COMPLETED", "completedAt": now()})
            return document
        return apply(transaction)

    def upload(self, uid: str, upload_id: str) -> dict[str, Any]:
        data = self.db.collection("uploads").document(upload_id).get().to_dict()
        if not data or data.get("uid") != uid: raise KeyError("UPLOAD_NOT_FOUND")
        return data

    def invoice(self, uid: str, invoice_id: str) -> dict[str, Any]:
        data = self.db.collection("invoices").document(invoice_id).get().to_dict()
        if not data or data.get("uid") != uid or data.get("state") == "DELETED": raise KeyError("INVOICE_NOT_FOUND")
        return data

    def invoices(self, uid: str) -> list[dict[str, Any]]:
        return [doc.to_dict() | {"id": doc.id} for doc in self.db.collection("invoices").where("uid", "==", uid).where("state", "!=", "DELETED").order_by("state").order_by("createdAt", direction=firestore.Query.DESCENDING).limit(100).stream()]

    def confirm(self, uid: str, invoice_id: str, version: int, fields: dict[str, Any]) -> dict[str, Any]:
        ref = self.db.collection("invoices").document(invoice_id); transaction = self.db.transaction()
        @firestore.transactional
        def apply(tx: firestore.Transaction) -> dict[str, Any]:
            data = ref.get(transaction=tx).to_dict()
            if not data or data.get("uid") != uid: raise KeyError("INVOICE_NOT_FOUND")
            if data.get("version") != version: raise RuntimeError("VERSION_CONFLICT")
            data.update({"fields": fields, "state": "COMPLETED", "version": version + 1, "confirmedAt": now()})
            tx.set(ref, data); tx.set(self.db.collection("audit_events").document(), {"uid": uid, "invoiceId": invoice_id, "action": "INVOICE_CONFIRMED", "timestamp": now()})
            return data
        return apply(transaction)

    def mark_ocr(self, invoice_id: str, fields: dict[str, Any] | None, diagnostic: str) -> bool:
        ref = self.db.collection("invoices").document(invoice_id)
        transaction = self.db.transaction()

        @firestore.transactional
        def apply(tx: firestore.Transaction) -> bool:
            data = ref.get(transaction=tx).to_dict()
            if not data or data.get("state") not in {"PROCESSING", "NEEDS_CORRECTION"}:
                return False
            tx.update(ref, {"fields": fields or {}, "state": "READY_TO_CONFIRM" if fields else "NEEDS_CORRECTION", "ocrDiagnostic": diagnostic, "ocrCompletedAt": now()})
            return True

        return apply(transaction)

    def mark_deleted(self, uid: str, invoice_id: str) -> None:
        self.invoice(uid, invoice_id); self.db.collection("invoices").document(invoice_id).update({"state": "DELETED", "deletedAt": now(), "fields": {}, "object": None}); self.db.collection("deletion_tombstones").document(invoice_id).set({"uidHash": __import__('hashlib').sha256(uid.encode()).hexdigest(), "deletedAt": now()})

    def apply_billing_event(self, event_id: str, payload: dict[str, Any]) -> bool:
        subscription = payload.get("payload", {}).get("subscription", {}).get("entity", {})
        uid = (subscription.get("notes") or {}).get("firebase_uid")
        status = subscription.get("status"); end = subscription.get("current_end")
        paid_until = datetime.fromtimestamp(end, UTC) if end else now()
        if status in {"active", "authenticated"}: update = {"plan": "PAID", "paidUntil": paid_until, "graceUntil": None}
        elif status in {"pending", "halted"}: update = {"plan": "PAST_DUE", "paidUntil": paid_until, "graceUntil": now() + timedelta(days=3)}
        elif status in {"cancelled", "completed"}: update = {"plan": "CANCEL_AT_PERIOD_END", "paidUntil": paid_until, "graceUntil": None}
        else: update = None
        event_ref = self.db.collection("billing_events").document(event_id)
        transaction = self.db.transaction()

        @firestore.transactional
        def apply(tx: firestore.Transaction) -> bool:
            if event_ref.get(transaction=tx).exists:
                return False
            tx.create(event_ref, {"processedAt": now(), "type": payload.get("event")})
            if uid and update:
                update["subscriptionId"] = subscription.get("id")
                tx.set(self.db.collection("users").document(uid), update, merge=True)
            return True

        return apply(transaction)

    def reserve_checkout(self, uid: str, request_id: str) -> None:
        ref = self.db.collection("users").document(uid)
        transaction = self.db.transaction()

        @firestore.transactional
        def apply(tx: firestore.Transaction) -> None:
            data = ref.get(transaction=tx).to_dict() or {}
            if data.get("plan") in {"PAID", "CANCEL_AT_PERIOD_END", "PAST_DUE"}:
                raise ValueError("SUBSCRIPTION_EXISTS")
            pending = data.get("pendingCheckout") or {}
            if pending.get("expiresAt") and pending["expiresAt"] > now():
                raise ValueError("CHECKOUT_PENDING")
            tx.set(ref, {"pendingCheckout": {"requestId": request_id, "expiresAt": now() + timedelta(minutes=15)}}, merge=True)

        apply(transaction)

    def complete_checkout(self, uid: str, request_id: str, subscription_id: str) -> None:
        ref = self.db.collection("users").document(uid)
        transaction = self.db.transaction()

        @firestore.transactional
        def apply(tx: firestore.Transaction) -> None:
            data = ref.get(transaction=tx).to_dict() or {}
            if (data.get("pendingCheckout") or {}).get("requestId") != request_id:
                raise RuntimeError("CHECKOUT_RESERVATION_LOST")
            tx.set(ref, {"pendingCheckout": None, "subscriptionId": subscription_id, "checkoutCreatedAt": now()}, merge=True)

        apply(transaction)

    def release_checkout(self, uid: str, request_id: str) -> None:
        ref = self.db.collection("users").document(uid)
        transaction = self.db.transaction()

        @firestore.transactional
        def apply(tx: firestore.Transaction) -> None:
            data = ref.get(transaction=tx).to_dict() or {}
            if (data.get("pendingCheckout") or {}).get("requestId") == request_id:
                tx.set(ref, {"pendingCheckout": None}, merge=True)

        apply(transaction)

    def subscription_id(self, uid: str) -> str:
        value = (self.db.collection("users").document(uid).get().to_dict() or {}).get("subscriptionId")
        if not value: raise KeyError("SUBSCRIPTION_NOT_FOUND")
        return str(value)

    def mark_cancel_requested(self, uid: str) -> None:
        self.db.collection("users").document(uid).set({"plan": "CANCEL_AT_PERIOD_END", "cancellationRequestedAt": now()}, merge=True)

    def create_support_grant(self, uid: str) -> dict[str, Any]:
        grant_id = __import__('secrets').token_urlsafe(24); expires_at = now() + timedelta(hours=1)
        self.db.collection("support_grants").document(grant_id).set({"uid": uid, "createdAt": now(), "expiresAt": expires_at, "revokedAt": None})
        return {"grantId": grant_id, "expiresAt": expires_at}

    def authorize_support_grant(self, grant_id: str, invoice_id: str) -> dict[str, Any]:
        grant_ref = self.db.collection("support_grants").document(grant_id)
        invoice_ref = self.db.collection("invoices").document(invoice_id)
        transaction = self.db.transaction()

        @firestore.transactional
        def apply(tx: firestore.Transaction) -> dict[str, Any]:
            grant = grant_ref.get(transaction=tx).to_dict()
            if not grant or grant.get("revokedAt") or not grant.get("expiresAt") or grant["expiresAt"] <= now():
                raise PermissionError("SUPPORT_GRANT_INVALID")
            invoice = invoice_ref.get(transaction=tx).to_dict()
            if not invoice or invoice.get("uid") != grant.get("uid") or invoice.get("state") == "DELETED":
                raise KeyError("INVOICE_NOT_FOUND")
            tx.set(self.db.collection("audit_events").document(), {"uid": grant["uid"], "invoiceId": invoice_id, "action": "SUPPORT_GRANT_USED", "timestamp": now()})
            return invoice

        return apply(transaction)

    def revoke_support_grant(self, uid: str, grant_id: str) -> None:
        ref = self.db.collection("support_grants").document(grant_id)
        data = ref.get().to_dict()
        if not data or data.get("uid") != uid:
            raise KeyError("SUPPORT_GRANT_NOT_FOUND")
        ref.update({"revokedAt": now()})

    def expired_invoices(self, limit: int = 200) -> list[tuple[str, dict[str, Any]]]:
        query = self.db.collection("invoices").where("state", "!=", "DELETED").where("expiresAt", "<=", now()).order_by("state").order_by("expiresAt")
        return [(doc.id, doc.to_dict()) for doc in query.limit(limit).stream()]

    def expire_invoice(self, invoice_id: str, data: dict[str, Any]) -> None:
        self.db.collection("invoices").document(invoice_id).update({"state": "DELETED", "deletedAt": now(), "fields": {}, "object": None})
        self.db.collection("deletion_tombstones").document(invoice_id).set({"uidHash": __import__('hashlib').sha256(data["uid"].encode()).hexdigest(), "deletedAt": now(), "reason": "RETENTION"})

    def set_processing_open(self, is_open: bool, reason: str) -> None:
        self.db.collection("system_controls").document("processing").set({"open": is_open, "reason": reason, "updatedAt": now()}, merge=True)
