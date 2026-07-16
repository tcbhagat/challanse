import hashlib
import hmac
import time


def sign_payload(secret: str, payload: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_payload(secret: str, payload: bytes, supplied_signature: str) -> bool:
    if not secret or not supplied_signature:
        return False
    return hmac.compare_digest(sign_payload(secret, payload), supplied_signature)


def verify_service_request(secret: str, payload: bytes, signature: str, timestamp: str, request_id: str) -> bool:
    try:
        timestamp_number = int(timestamp)
    except ValueError:
        return False
    if not request_id or abs(int(time.time()) - timestamp_number) > 60:
        return False
    signed = f"{timestamp}.{request_id}.".encode("utf-8") + payload
    return verify_payload(secret, signed, signature)
