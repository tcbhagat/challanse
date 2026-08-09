from datetime import UTC, datetime
import pytest
from app.schemas import ConfirmInvoice, ConsentRequest, InvoiceView

def test_invoice_requires_supported_unit():
    invoice = ConfirmInvoice(vendor="Vendor", invoiceNumber="CH-1", invoiceDate="2026-08-09", material="Cement", quantity=25, unit="BAG", version=1)
    assert invoice.unit == "BAG"

def test_public_states_are_plain_and_stable():
    view = InvoiceView(id="id", state="PROCESSING", filename="invoice.webp", createdAt=datetime.now(UTC), expiresAt=datetime.now(UTC), version=1, fields={})
    assert view.state == "PROCESSING"

def test_consent_version_is_bounded():
    assert ConsentRequest(version="2026-08-09").version == "2026-08-09"
    with pytest.raises(ValueError): ConsentRequest(version="x" * 33)
