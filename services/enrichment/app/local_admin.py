import shutil
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from cryptography import x509
from psycopg.rows import dict_row

from .config import Settings
from .local_ocr import prewarm_model
from .local_storage import local_storage_percent
from .object_store import object_store_client
from .tenancy import system_connection
from .tesseract_runner import TesseractExecutionError, tesseract_languages, tesseract_version
from .pilot_control import activation_readiness, current_pilot_mode
from .local_backup import latest_backup_status
from .audit_chain import verify_audit_chains, verify_local_operator_chain


def local_status(settings: Settings) -> dict[str, Any]:
    if not settings.synthetic_mode:
        raise RuntimeError("synthetic_mode_required")
    root = Path(settings.local_data_root)
    usage = shutil.disk_usage(root)
    storage_percent = round(local_storage_percent(settings), 1)
    with system_connection(settings.system_database_url or settings.database_url, row_factory=dict_row) as connection:
        queue = connection.execute(
            """
            SELECT COUNT(*) FILTER (WHERE status IN ('PENDING', 'FAILED_RETRYABLE', 'PROCESSING')) AS pending,
                   COUNT(*) FILTER (WHERE status = 'FAILED_TERMINAL') AS failed
            FROM local_receipt_queue
            """
        ).fetchone()
        ollama_health = connection.execute(
            """
            SELECT status, model_name, checked_at > NOW() - INTERVAL '45 seconds' AS fresh
            FROM local_service_health
            WHERE service_name = 'ollama'
            """
        ).fetchone()
        latest_test_run = connection.execute(
            """
            SELECT id, status, completed_at, artifact_directory
            FROM local_test_runs
            ORDER BY requested_at DESC
            LIMIT 1
            """
        ).fetchone()
        connection.execute("SELECT 1")
    ollama_ready = bool(
        ollama_health
        and ollama_health["status"] == "READY"
        and ollama_health["model_name"] == settings.ollama_model
        and ollama_health["fresh"]
    )
    try:
        version = tesseract_version()
        languages = tesseract_languages()
        required_languages = set(settings.tesseract_languages.split("+"))
        tesseract_ready = required_languages.issubset(languages)
    except TesseractExecutionError:
        version = "unavailable"
        tesseract_ready = False
    try:
        object_store_client(settings).head_bucket(Bucket=settings.receipt_bucket)
        object_store_ready = True
    except Exception:
        object_store_ready = False
    pilot_mode = current_pilot_mode(settings)
    certificate = {"status": "unavailable", "expiresAt": None, "daysRemaining": None}
    certificate_path = Path(settings.local_tls_certificate_path) if settings.local_tls_certificate_path else None
    if certificate_path and certificate_path.is_file():
        try:
            parsed = x509.load_pem_x509_certificate(certificate_path.read_bytes())
            expires_at = parsed.not_valid_after_utc
            days_remaining = max(0, int((expires_at - datetime.now(UTC)).total_seconds() // 86400))
            certificate = {
                "status": "ready" if days_remaining >= 30 else "warning",
                "expiresAt": expires_at.isoformat(),
                "daysRemaining": days_remaining,
            }
        except ValueError:
            pass
    fixtures_ready = False
    manifest_path = root / "fixtures" / "manifest.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            fixtures_ready = len(manifest) == 5 and all(item.get("synthetic") is True for item in manifest)
        except (OSError, ValueError, TypeError):
            fixtures_ready = False
    latest_run = None
    if latest_test_run:
        latest_run = {
            "id": str(latest_test_run["id"]),
            "status": str(latest_test_run["status"]),
            "completedAt": latest_test_run["completed_at"].isoformat() if latest_test_run["completed_at"] else None,
            "evidenceAvailable": bool(latest_test_run["artifact_directory"]),
        }
    receipt_audit = verify_audit_chains(settings.system_database_url or settings.database_url)
    operator_audit = verify_local_operator_chain(settings.system_database_url or settings.database_url)
    return {
        "syntheticMode": pilot_mode == "synthetic-demo",
        "pilotMode": pilot_mode,
        "activation": activation_readiness(settings),
        "backup": latest_backup_status(),
        "auditChain": {
            "valid": bool(receipt_audit["valid"]) and bool(operator_audit["valid"]),
            "eventsChecked": int(receipt_audit["eventsChecked"]) + int(operator_audit["eventsChecked"]),
            "chainsChecked": int(receipt_audit.get("chainsChecked", 0)) + int(operator_audit.get("chainsChecked", 0)),
        },
        "database": "ready",
        "objectStore": "ready" if object_store_ready else "unavailable",
        "ollama": "ready" if ollama_ready else "unavailable",
        "model": settings.ollama_model,
        "tesseract": "ready" if tesseract_ready else "unavailable",
        "tesseractVersion": version,
        "queueDepth": int(queue["pending"] or 0),
        "terminalFailures": int(queue["failed"] or 0),
        "certificate": certificate,
        "testData": {"ready": fixtures_ready},
        "latestTestRun": latest_run,
        "storage": {
            "usedBytes": usage.used,
            "limitBytes": settings.local_storage_limit_bytes,
            "percent": storage_percent,
            "warning": storage_percent >= 70,
            "uploadsPaused": storage_percent >= 90,
        },
    }


def reset_synthetic_data(settings: Settings, confirmation: str) -> None:
    if not settings.synthetic_mode or settings.environment != "local-pilot":
        raise RuntimeError("synthetic_mode_required")
    if confirmation != "RESET SYNTHETIC DATA":
        raise RuntimeError("synthetic_reset_confirmation_invalid")
    if current_pilot_mode(settings) != "synthetic-demo":
        raise RuntimeError("controlled_client_pilot_reset_forbidden")
    with system_connection(settings.system_database_url or settings.database_url) as connection:
        connection.execute("DELETE FROM local_reviewer_sessions")
        connection.execute("DELETE FROM local_reviewer_credentials")
        connection.execute("DELETE FROM local_auth_events")
        connection.execute("DELETE FROM organizations")
        connection.execute("DELETE FROM users")
        connection.execute("DELETE FROM pilot_requests")
        connection.commit()


def prewarm_local_model(settings: Settings) -> str:
    if not settings.synthetic_mode:
        raise RuntimeError("synthetic_mode_required")
    return prewarm_model(settings)
