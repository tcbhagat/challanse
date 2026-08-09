import hashlib
import hmac
from fastapi import Header, HTTPException
import firebase_admin
from firebase_admin import app_check, auth
from .config import settings
from .schemas import Principal

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={"projectId": settings.project_id})

async def principal(authorization: str = Header(default=""), x_firebase_appcheck: str = Header(default="")) -> Principal:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required.")
    try:
        token = auth.verify_id_token(authorization.removeprefix("Bearer "), check_revoked=True)
        if settings.require_app_check:
            if not x_firebase_appcheck:
                raise ValueError("missing app check")
            app_check.verify_token(x_firebase_appcheck)
    except Exception as error:
        raise HTTPException(401, "Authentication could not be verified.") from error
    if not token.get("email_verified"):
        raise HTTPException(403, "Verify your email before continuing.")
    return Principal(uid=token["uid"], email=token.get("email", ""), email_verified=True)

def verify_razorpay_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return bool(signature) and hmac.compare_digest(expected, signature)

def spreadsheet_safe(value):
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value
