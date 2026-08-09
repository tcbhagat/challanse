from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator

MimeType = Literal["image/jpeg", "image/png", "image/webp"]
InvoiceState = Literal["UPLOADING", "PROCESSING", "READY_TO_CONFIRM", "COMPLETED", "NEEDS_CORRECTION", "DELETED"]
Unit = Literal["BAG", "KG", "TON", "NOS", "LTR", "M3", "UNIT"]

class UploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=180)
    mimeType: MimeType
    totalBytes: int = Field(gt=0, le=5_000_000)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value: str) -> str:
        if value in {".", ".."} or any(ch in value for ch in ("/", "\\", "\x00", "\r", "\n")):
            raise ValueError("unsafe filename")
        return value

class InvoiceFields(BaseModel):
    vendor: str = Field(default="", max_length=160)
    invoiceNumber: str = Field(default="", max_length=120)
    invoiceDate: str = Field(default="", pattern=r"^$|^\d{4}-\d{2}-\d{2}$")
    material: str = Field(default="", max_length=240)
    quantity: float | None = Field(default=None, ge=0, le=1_000_000_000)
    unit: Unit | None = None

class ConfirmInvoice(InvoiceFields):
    version: int = Field(gt=0)

class InvoiceView(BaseModel):
    id: str
    state: InvoiceState
    filename: str
    createdAt: datetime
    expiresAt: datetime
    version: int
    fields: InvoiceFields

class Principal(BaseModel):
    uid: str
    email: str
    email_verified: bool

class ConsentRequest(BaseModel):
    version: str = Field(min_length=1, max_length=32)
