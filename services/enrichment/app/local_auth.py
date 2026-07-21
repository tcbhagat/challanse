import base64
import hashlib
import html
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs
from uuid import UUID, uuid4

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from psycopg.rows import dict_row

from .config import Settings
from .tenancy import system_connection


SESSION_COOKIE = "challanse_local_session"
CSRF_COOKIE = "challanse_local_csrf"
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65_536, parallelism=2)
DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash("challanse-dummy-password-not-used")
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class LocalAuthError(RuntimeError):
    pass


@dataclass(frozen=True)
class LocalIdentity:
    user_id: UUID
    email: str
    subject: str
    csrf_token: str


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _fernet(settings: Settings) -> Fernet:
    try:
        raw = bytes.fromhex(settings.local_auth_encryption_key)
    except ValueError as error:
        raise LocalAuthError("local_auth_encryption_key_invalid") from error
    if len(raw) != 32:
        raise LocalAuthError("local_auth_encryption_key_invalid")
    return Fernet(base64.urlsafe_b64encode(raw))


def _audit(connection, event_type: str, user_id: UUID | None, details: dict[str, object] | None = None) -> None:
    connection.execute(
        "INSERT INTO local_auth_events (id, user_id, event_type, event_json) VALUES (%s, %s, %s, %s)",
        (uuid4(), user_id, event_type, json.dumps(details or {})),
    )


def enroll_reviewer(settings: Settings, email: str, password: str) -> tuple[str, list[str]]:
    normalized_email = email.strip().lower()
    if len(password) < 14:
        raise LocalAuthError("reviewer_password_too_short")
    secret = pyotp.random_base32()
    recovery_codes = [secrets.token_urlsafe(10) for _ in range(8)]
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        user = connection.execute(
            "SELECT id FROM users WHERE LOWER(email) = %s AND active",
            (normalized_email,),
        ).fetchone()
        if not user:
            raise LocalAuthError("reviewer_membership_not_found")
        user_id = UUID(str(user["id"]))
        exists = connection.execute(
            "SELECT 1 FROM local_reviewer_credentials WHERE user_id = %s",
            (user_id,),
        ).fetchone()
        event_type = "CREDENTIAL_ROTATED" if exists else "ENROLLED"
        connection.execute(
            """
            INSERT INTO local_reviewer_credentials
              (user_id, password_hash, totp_secret_ciphertext, recovery_code_hashes, failed_attempts, locked_until, enabled)
            VALUES (%s, %s, %s, %s, 0, NULL, TRUE)
            ON CONFLICT (user_id) DO UPDATE SET
              password_hash = excluded.password_hash,
              totp_secret_ciphertext = excluded.totp_secret_ciphertext,
              recovery_code_hashes = excluded.recovery_code_hashes,
              failed_attempts = 0,
              locked_until = NULL,
              enabled = TRUE,
              updated_at = NOW()
            """,
            (
                user_id,
                PASSWORD_HASHER.hash(password),
                _fernet(settings).encrypt(secret.encode()),
                json.dumps([_sha256(code) for code in recovery_codes]),
            ),
        )
        connection.execute("DELETE FROM local_reviewer_sessions WHERE user_id = %s", (user_id,))
        _audit(connection, event_type, user_id)
        connection.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=normalized_email, issuer_name="ChallanSe Local Pilot")
    return uri, recovery_codes


def _verify_second_factor(secret: str, supplied: str, recovery_hashes: list[str]) -> tuple[bool, list[str], bool]:
    if pyotp.TOTP(secret).verify(supplied, valid_window=1):
        return True, recovery_hashes, False
    supplied_hash = _sha256(supplied)
    if supplied_hash in recovery_hashes:
        return True, [value for value in recovery_hashes if value != supplied_hash], True
    return False, recovery_hashes, False


def authenticate(settings: Settings, email: str, password: str, second_factor: str) -> tuple[str, str, LocalIdentity]:
    normalized_email = email.strip().lower()
    now = datetime.now(timezone.utc)
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        credential = connection.execute(
            """
            SELECT c.*, u.email
            FROM local_reviewer_credentials c JOIN users u ON u.id = c.user_id
            WHERE LOWER(u.email) = %s AND u.active AND c.enabled
            FOR UPDATE
            """,
            (normalized_email,),
        ).fetchone()
        if not credential:
            try:
                PASSWORD_HASHER.verify(DUMMY_PASSWORD_HASH, password)
            except VerifyMismatchError:
                pass
            _audit(connection, "LOGIN_FAILED", None, {"reason": "invalid_credentials"})
            connection.commit()
            raise LocalAuthError("invalid_credentials")
        user_id = UUID(str(credential["user_id"]))
        if credential["locked_until"] and credential["locked_until"] > now:
            raise LocalAuthError("account_locked")
        try:
            password_valid = PASSWORD_HASHER.verify(str(credential["password_hash"]), password)
        except (VerifyMismatchError, InvalidHashError):
            password_valid = False
        try:
            secret = _fernet(settings).decrypt(bytes(credential["totp_secret_ciphertext"])).decode()
        except InvalidToken as error:
            raise LocalAuthError("reviewer_mfa_secret_invalid") from error
        recovery_hashes = list(credential["recovery_code_hashes"] or [])
        factor_valid, remaining_codes, recovery_used = _verify_second_factor(secret, second_factor.strip(), recovery_hashes)
        if not password_valid or not factor_valid:
            failed_attempts = int(credential["failed_attempts"]) + 1
            locked_until = now + timedelta(minutes=LOCKOUT_MINUTES) if failed_attempts >= MAX_FAILED_ATTEMPTS else None
            connection.execute(
                "UPDATE local_reviewer_credentials SET failed_attempts = %s, locked_until = %s, updated_at = NOW() WHERE user_id = %s",
                (failed_attempts, locked_until, user_id),
            )
            _audit(connection, "LOCKED" if locked_until else "LOGIN_FAILED", user_id)
            connection.commit()
            raise LocalAuthError("invalid_credentials")
        token = secrets.token_urlsafe(48)
        csrf = secrets.token_urlsafe(32)
        expires_at = now + timedelta(minutes=settings.local_session_ttl_minutes)
        connection.execute(
            "UPDATE local_reviewer_credentials SET failed_attempts = 0, locked_until = NULL, recovery_code_hashes = %s, updated_at = NOW() WHERE user_id = %s",
            (json.dumps(remaining_codes), user_id),
        )
        connection.execute("DELETE FROM local_reviewer_sessions WHERE expires_at < NOW() OR user_id = %s", (user_id,))
        connection.execute(
            "INSERT INTO local_reviewer_sessions (token_hash, user_id, csrf_hash, expires_at) VALUES (%s, %s, %s, %s)",
            (_sha256(token), user_id, _sha256(csrf), expires_at),
        )
        _audit(connection, "RECOVERY_CODE_USED" if recovery_used else "LOGIN_SUCCEEDED", user_id)
        connection.commit()
    return token, csrf, LocalIdentity(user_id, normalized_email, f"local:{normalized_email}", csrf)


def validate_session(settings: Settings, token: str, csrf: str, method: str) -> LocalIdentity:
    if not token:
        raise LocalAuthError("session_required")
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        session = connection.execute(
            """
            SELECT s.user_id, s.csrf_hash, u.email
            FROM local_reviewer_sessions s JOIN users u ON u.id = s.user_id
            JOIN local_reviewer_credentials c ON c.user_id = u.id
            WHERE s.token_hash = %s AND s.expires_at > NOW() AND u.active AND c.enabled
            """,
            (_sha256(token),),
        ).fetchone()
        if not session:
            raise LocalAuthError("session_invalid")
        if method.upper() in MUTATING_METHODS and not secrets.compare_digest(_sha256(csrf), str(session["csrf_hash"])):
            raise LocalAuthError("csrf_invalid")
        connection.execute(
            "UPDATE local_reviewer_sessions SET last_seen_at = NOW() WHERE token_hash = %s",
            (_sha256(token),),
        )
        connection.commit()
    email = str(session["email"]).lower()
    return LocalIdentity(UUID(str(session["user_id"])), email, f"local:{email}", csrf)


def logout(settings: Settings, token: str) -> None:
    if not token:
        return
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        row = connection.execute(
            "DELETE FROM local_reviewer_sessions WHERE token_hash = %s RETURNING user_id",
            (_sha256(token),),
        ).fetchone()
        if row:
            _audit(connection, "LOGOUT", UUID(str(row["user_id"])))
        connection.commit()


def login_page(message: str = "", next_path: str = "/") -> str:
    safe_next = next_path if next_path.startswith("/") and not next_path.startswith("//") else "/"
    error = f'<p role="alert">{html.escape(message)}</p>' if message else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChallanSe sign in</title><style>body{{font-family:system-ui;background:#07111f;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}}main{{width:min(90%,24rem)}}label,input,button{{display:block;width:100%;box-sizing:border-box}}input,button{{min-height:48px;margin:.4rem 0 1rem;padding:.75rem;font-size:1rem}}button{{background:#f59e0b;border:0;font-weight:700}}p{{color:#fca5a5}}</style></head><body><main><h1>ChallanSe</h1>{error}<form method="post" action="/login"><input type="hidden" name="next" value="{html.escape(safe_next)}"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><label>Authenticator or recovery code<input name="second_factor" inputmode="numeric" autocomplete="one-time-code" required></label><button type="submit">Sign in</button></form></main></body></html>"""


def parse_login_form(body: bytes) -> tuple[str, str, str, str]:
    values = parse_qs(body.decode("utf-8", errors="strict"), keep_blank_values=True, max_num_fields=8)
    return (
        values.get("email", [""])[0],
        values.get("password", [""])[0],
        values.get("second_factor", [""])[0],
        values.get("next", ["/"])[0],
    )
