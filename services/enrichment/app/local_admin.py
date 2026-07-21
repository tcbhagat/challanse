import shutil
from pathlib import Path
from typing import Any

import httpx
from psycopg.rows import dict_row

from .config import Settings
from .local_ocr import prewarm_model
from .local_storage import local_storage_percent
from .object_store import object_store_client
from .tenancy import system_connection
from .tesseract_runner import TesseractExecutionError, tesseract_languages, tesseract_version
from .pilot_control import activation_readiness, current_pilot_mode
from .local_backup import latest_backup_status
from .audit_chain import verify_audit_chains


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
        connection.execute("SELECT 1")
    try:
        response = httpx.get(f"{settings.ollama_url.rstrip('/')}/api/tags", timeout=3.0)
        response.raise_for_status()
        model_names = {str(model.get("name", "")) for model in response.json().get("models", [])}
        ollama_ready = settings.ollama_model in model_names
    except Exception:
        ollama_ready = False
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
    return {
        "syntheticMode": pilot_mode == "synthetic-demo",
        "pilotMode": pilot_mode,
        "activation": activation_readiness(settings),
        "backup": latest_backup_status(),
        "auditChain": verify_audit_chains(settings.system_database_url or settings.database_url),
        "database": "ready",
        "objectStore": "ready" if object_store_ready else "unavailable",
        "ollama": "ready" if ollama_ready else "unavailable",
        "model": settings.ollama_model,
        "tesseract": "ready" if tesseract_ready else "unavailable",
        "tesseractVersion": version,
        "queueDepth": int(queue["pending"] or 0),
        "terminalFailures": int(queue["failed"] or 0),
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
