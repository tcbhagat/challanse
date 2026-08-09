import base64
import csv
import io
import json
import uuid
import httpx
from google.api_core.exceptions import GoogleAPIError, NotFound
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from .cloud import ObjectStore, TaskQueue
from .config import settings
from .images import validate_and_sanitize
from .schemas import ConfirmInvoice, ConsentRequest, InvoiceFields, InvoiceView, Principal, UploadRequest
from .security import principal, verify_razorpay_signature
from .store import FirestoreStore
from .tesseract import extract_fields

app = FastAPI(title="ChallanSe API", docs_url=None if settings.environment == "production" else "/docs")
store = FirestoreStore(); objects = ObjectStore(); tasks = TaskQueue()

def view(invoice_id: str, data: dict) -> InvoiceView:
    return InvoiceView(id=invoice_id, state=data["state"], filename=data["filename"], createdAt=data["createdAt"], expiresAt=data["expiresAt"], version=data["version"], fields=InvoiceFields.model_validate(data.get("fields") or {}))

@app.get("/health")
def health(): return {"status": "ok"}

@app.get("/api/v1/me/usage")
def usage(user: Principal = Depends(principal)):
    entitlement = store.entitlement(user.uid)
    return {"plan": entitlement.plan, "usedToday": store.usage(user.uid), "dailyLimit": entitlement.daily_limit, "retentionDays": entitlement.retention_days, "consentRequired": not store.has_current_consent(user.uid), "consentVersion": settings.consent_version}

@app.post("/api/v1/me/consent", status_code=204)
def consent(payload: ConsentRequest, user: Principal = Depends(principal)):
    try: store.record_consent(user.uid, payload.version)
    except ValueError as error: raise HTTPException(409, "Terms have changed. Refresh and review them again.") from error
    return Response(status_code=204)

@app.post("/api/v1/uploads", status_code=201)
def create_upload(payload: UploadRequest, user: Principal = Depends(principal)):
    upload_id = str(uuid.uuid4()); object_name = f"quarantine/{user.uid}/{upload_id}"
    try: store.reserve_upload(user.uid, upload_id, payload.model_dump() | {"object": object_name}, store.entitlement(user.uid))
    except PermissionError as error: raise HTTPException(428, "Accept the privacy and retention terms before uploading.") from error
    except ValueError as error: raise HTTPException(429, "Daily processing capacity reached. Please try tomorrow.") from error
    return {"uploadId": upload_id, "uploadUrl": objects.signed_upload(object_name, payload.mimeType, payload.totalBytes)}

@app.post("/api/v1/uploads/{upload_id}/complete", response_model=InvoiceView)
def complete_upload(upload_id: str, user: Principal = Depends(principal)):
    try:
        try:
            existing = store.invoice(user.uid, upload_id)
            if existing["state"] == "PROCESSING": tasks.enqueue_ocr(upload_id)
            return view(upload_id, existing)
        except KeyError:
            pass
        upload = store.upload(user.uid, upload_id); raw = objects.read_upload(upload["object"])
        sanitized, mime_type = validate_and_sanitize(raw, upload["mimeType"], upload["sha256"])
        accepted_name = f"invoices/{user.uid}/{upload_id}.webp"; objects.accept(accepted_name, sanitized, mime_type)
        try: invoice = store.finalize_upload(user.uid, upload_id, accepted_name)
        except Exception:
            objects.delete_accepted(accepted_name)
            raise
        tasks.enqueue_ocr(upload_id); objects.delete_upload(upload["object"])
        return view(upload_id, invoice)
    except KeyError as error: raise HTTPException(404, "Upload not found.") from error
    except ValueError as error: raise HTTPException(422, str(error)) from error

@app.get("/api/v1/invoices")
def invoices(user: Principal = Depends(principal)): return {"invoices": [view(item.pop("id"), item) for item in store.invoices(user.uid)]}

@app.get("/api/v1/invoices/{invoice_id}", response_model=InvoiceView)
def invoice(invoice_id: str, user: Principal = Depends(principal)):
    try: return view(invoice_id, store.invoice(user.uid, invoice_id))
    except KeyError as error: raise HTTPException(404, "Invoice not found.") from error

@app.patch("/api/v1/invoices/{invoice_id}", response_model=InvoiceView)
def confirm(invoice_id: str, payload: ConfirmInvoice, user: Principal = Depends(principal)):
    try: return view(invoice_id, store.confirm(user.uid, invoice_id, payload.version, payload.model_dump(exclude={"version"})))
    except KeyError as error: raise HTTPException(404, "Invoice not found.") from error
    except RuntimeError as error: raise HTTPException(409, "Invoice changed. Refresh and try again.") from error

@app.delete("/api/v1/invoices/{invoice_id}", status_code=204)
def delete(invoice_id: str, user: Principal = Depends(principal)):
    try:
        invoice_data = store.invoice(user.uid, invoice_id)
        try: objects.delete_accepted(invoice_data["object"])
        except NotFound: pass
        store.mark_deleted(user.uid, invoice_id)
    except KeyError as error: raise HTTPException(404, "Invoice not found.") from error
    return Response(status_code=204)

@app.get("/api/v1/invoices/{invoice_id}/image")
def image(invoice_id: str, user: Principal = Depends(principal)):
    try: return {"url": objects.signed_read(store.invoice(user.uid, invoice_id)["object"]), "expiresInSeconds": 300}
    except KeyError as error: raise HTTPException(404, "Invoice not found.") from error

@app.get("/api/v1/invoices/{invoice_id}/exports/{format}")
def export(invoice_id: str, format: str, user: Principal = Depends(principal)):
    if format not in {"csv", "json"}: raise HTTPException(404, "Export format not found.")
    try: data = view(invoice_id, store.invoice(user.uid, invoice_id)).model_dump(mode="json")
    except KeyError as error: raise HTTPException(404, "Invoice not found.") from error
    headers = {"Content-Disposition": f'attachment; filename="challanse-{invoice_id}.{format}"', "Cache-Control": "no-store"}
    if format == "json": return Response(json.dumps(data, ensure_ascii=False), media_type="application/json", headers=headers)
    output = io.StringIO(); writer = csv.DictWriter(output, fieldnames=["vendor", "invoiceNumber", "invoiceDate", "material", "quantity", "unit"]); writer.writeheader(); writer.writerow(data["fields"])
    return Response(output.getvalue(), media_type="text/csv", headers=headers)

@app.post("/api/v1/support-grants", status_code=201)
def support_grant(user: Principal = Depends(principal)): return store.create_support_grant(user.uid)

@app.post("/api/v1/billing/checkout", status_code=201)
async def billing_checkout(user: Principal = Depends(principal)):
    if not settings.razorpay_key_id or not settings.razorpay_key_secret or not settings.razorpay_plan_id: raise HTTPException(503, "Paid plan is not available yet.")
    payload = {"plan_id": settings.razorpay_plan_id, "total_count": 100, "quantity": 1, "customer_notify": 1, "notes": {"firebase_uid": user.uid}}
    async with httpx.AsyncClient(timeout=10) as client: response = await client.post("https://api.razorpay.com/v1/subscriptions", auth=(settings.razorpay_key_id, settings.razorpay_key_secret), json=payload)
    if response.status_code >= 300: raise HTTPException(502, "Checkout could not be created.")
    subscription = response.json(); return {"keyId": settings.razorpay_key_id, "subscriptionId": subscription["id"], "amountInr": 499}

@app.post("/api/v1/billing/cancel", status_code=204)
async def billing_cancel(user: Principal = Depends(principal)):
    if not settings.razorpay_key_id or not settings.razorpay_key_secret: raise HTTPException(503, "Billing is not available yet.")
    try: subscription_id = store.subscription_id(user.uid)
    except KeyError as error: raise HTTPException(404, "Active subscription not found.") from error
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(f"https://api.razorpay.com/v1/subscriptions/{subscription_id}/cancel", auth=(settings.razorpay_key_id, settings.razorpay_key_secret), json={"cancel_at_cycle_end": 1})
    if response.status_code >= 300: raise HTTPException(502, "Cancellation could not be scheduled.")
    store.mark_cancel_requested(user.uid)
    return Response(status_code=204)

@app.post("/internal/tasks/ocr/{invoice_id}", status_code=204)
def run_ocr(invoice_id: str, x_cloudtasks_taskname: str = Header(default="")):
    if settings.service_role != "worker": raise HTTPException(404, "Not found.")
    if settings.environment == "production" and not x_cloudtasks_taskname: raise HTTPException(403, "Task authentication required.")
    snapshot = store.db.collection("invoices").document(invoice_id).get(); invoice_data = snapshot.to_dict()
    if not invoice_data or invoice_data.get("state") not in {"PROCESSING", "NEEDS_CORRECTION"}: return Response(status_code=204)
    try: fields, diagnostic = extract_fields(objects.read_accepted(invoice_data["object"])); store.mark_ocr(invoice_id, fields.model_dump(), diagnostic)
    except Exception: store.mark_ocr(invoice_id, None, json.dumps({"status": "manual_confirmation_required"}))
    return Response(status_code=204)

@app.post("/internal/tasks/retention", status_code=204)
def retention(x_cloudscheduler: str = Header(default="")):
    if settings.service_role != "worker": raise HTTPException(404, "Not found.")
    if settings.environment == "production" and not x_cloudscheduler: raise HTTPException(403, "Scheduler authentication required.")
    for invoice_id, data in store.expired_invoices():
        object_name = data.get("object")
        object_removed = True
        if object_name:
            try: objects.delete_accepted(object_name)
            except GoogleAPIError: object_removed = False
        if object_removed: store.expire_invoice(invoice_id, data)
    return Response(status_code=204)

@app.post("/internal/tasks/budget", status_code=204)
async def budget_control(request: Request):
    if settings.service_role != "worker": raise HTTPException(404, "Not found.")
    envelope = await request.json()
    try:
        payload = json.loads(base64.b64decode(envelope["message"]["data"]))
        cost = float(payload["costAmount"]); budget = float(payload["budgetAmount"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error: raise HTTPException(400, "Invalid budget message.") from error
    if budget <= 0: raise HTTPException(400, "Invalid budget amount.")
    if cost >= budget * .9: store.set_processing_open(False, "MONTHLY_BUDGET_90_PERCENT")
    return Response(status_code=204)

@app.post("/api/v1/webhooks/razorpay", status_code=204)
async def razorpay(request: Request, x_razorpay_signature: str = Header(default="")):
    body = await request.body()
    if not settings.razorpay_webhook_secret or not verify_razorpay_signature(body, x_razorpay_signature, settings.razorpay_webhook_secret): raise HTTPException(401, "Invalid signature.")
    payload = json.loads(body); event_id = payload.get("event_id") or request.headers.get("x-razorpay-event-id")
    if not event_id: event_id = __import__('hashlib').sha256(body).hexdigest()
    if not store.record_webhook(event_id, payload): return Response(status_code=204)
    store.apply_subscription_event(payload)
    return Response(status_code=204)
