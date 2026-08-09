import hashlib
import io
import pytest
from PIL import Image
from app.images import validate_and_sanitize
from app.schemas import UploadRequest
from app.security import verify_razorpay_signature

def image_bytes(fmt: str = "PNG") -> bytes:
    output = io.BytesIO(); Image.new("RGB", (128, 128), "white").save(output, format=fmt); return output.getvalue()

def test_sanitizes_valid_image_to_webp():
    source = image_bytes(); cleaned, mime = validate_and_sanitize(source, "image/png", hashlib.sha256(source).hexdigest())
    assert mime == "image/webp" and cleaned[:4] == b"RIFF"

def test_rejects_mime_mismatch():
    source = image_bytes()
    with pytest.raises(ValueError): validate_and_sanitize(source, "image/jpeg", hashlib.sha256(source).hexdigest())

def test_rejects_checksum_mismatch():
    with pytest.raises(ValueError): validate_and_sanitize(image_bytes(), "image/png", "0" * 64)

@pytest.mark.parametrize("filename", ["../x.png", "x/y.png", "x\\y.png", "bad\n.png"])
def test_rejects_hostile_filename(filename):
    with pytest.raises(ValueError): UploadRequest(filename=filename, mimeType="image/png", totalBytes=100, sha256="a" * 64)

def test_webhook_signature_is_constant_time_verified():
    import hmac
    body = b'{"event":"subscription.activated"}'; secret = "test-secret"
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert verify_razorpay_signature(body, signature, secret)
    assert not verify_razorpay_signature(body, "0" * 64, secret)
