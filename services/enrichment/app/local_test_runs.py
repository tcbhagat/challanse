import hashlib
import json
import shutil
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from psycopg.rows import dict_row

from .audit_chain import audit_event_hash
from .config import Settings
from .local_acceptance import cleanup_acceptance, prepare_acceptance, verify_acceptance_cleanup
from .local_admin import local_status, prewarm_local_model
from .local_fixtures import generate_local_fixtures
from .tenancy import system_connection
from .tesseract_runner import tesseract_languages, tesseract_version


ACTIVE_STATUSES = {"QUEUED", "RUNNING", "CANCEL_REQUESTED"}
TERMINAL_STATUSES = {"CANCELLED", "PASSED", "FAILED"}
ARTIFACT_NAMES = {
    "acceptance-report.json",
    "runtime-status.json",
    "fixture-manifest.json",
    "environment.json",
    "limitations.txt",
    "ui-validation.json",
    "operator-desktop.png",
    "operator-mobile.png",
    "runtime-manifest.json",
}


class LocalTestRunError(RuntimeError):
    pass


def _require_local_synthetic(settings: Settings) -> None:
    if settings.environment != "local-pilot" or not settings.synthetic_mode:
        raise LocalTestRunError("local_test_runs_require_synthetic_mode")


def _operator_audit(settings: Settings, user_id: UUID, event_type: str, event: dict[str, object]) -> None:
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended('local-operator-audit', 0))")
        previous = connection.execute(
            "SELECT event_hash FROM local_operator_events ORDER BY created_at DESC, id DESC LIMIT 1"
        ).fetchone()
        previous_hash = str(previous["event_hash"]) if previous else ""
        event_hash = audit_event_hash(previous_hash, {"eventType": event_type, **event})
        connection.execute(
            """
            INSERT INTO local_operator_events
              (id, user_id, event_type, event_json, previous_hash, event_hash)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (uuid4(), user_id, event_type, json.dumps(event), previous_hash or None, event_hash),
        )
        connection.commit()


def _serialize(row: dict[str, object]) -> dict[str, object]:
    return {
        "id": str(row["id"]),
        "status": row["status"],
        "stage": row["stage"],
        "progress": int(row["progress"]),
        "report": dict(row["report_json"] or {}),
        "errorCode": row["error_code"],
        "requestedAt": row["requested_at"].isoformat(),
        "startedAt": row["started_at"].isoformat() if row["started_at"] else None,
        "completedAt": row["completed_at"].isoformat() if row["completed_at"] else None,
        "artifactsAvailable": bool(row["artifact_directory"]),
    }


def prune_test_runs(settings: Settings, retention_days: int = 30) -> int:
    _require_local_synthetic(settings)
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        rows = connection.execute(
            """
            SELECT id, artifact_directory FROM local_test_runs
            WHERE status IN ('CANCELLED', 'PASSED', 'FAILED') AND completed_at < %s
            """,
            (cutoff,),
        ).fetchall()
        for row in rows:
            directory = str(row["artifact_directory"] or "")
            if directory:
                resolved = Path(directory).resolve()
                allowed_root = (Path(settings.local_data_root) / "exports" / "test-runs").resolve()
                if resolved.is_relative_to(allowed_root):
                    shutil.rmtree(resolved, ignore_errors=True)
        if rows:
            connection.execute("DELETE FROM local_test_runs WHERE id = ANY(%s)", ([row["id"] for row in rows],))
        connection.commit()
    return len(rows)


def create_test_run(settings: Settings, requested_by: UUID) -> dict[str, object]:
    _require_local_synthetic(settings)
    prune_test_runs(settings)
    run_id = uuid4()
    try:
        with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
            row = connection.execute(
                """
                INSERT INTO local_test_runs (id, requested_by)
                VALUES (%s, %s)
                RETURNING *
                """,
                (run_id, requested_by),
            ).fetchone()
            connection.commit()
    except Exception as error:
        if getattr(error, "sqlstate", "") == "23505":
            raise LocalTestRunError("local_test_run_already_active") from error
        raise
    _operator_audit(settings, requested_by, "TEST_RUN_QUEUED", {"runId": str(run_id)})
    return _serialize(dict(row))


def list_test_runs(settings: Settings, limit: int = 20) -> list[dict[str, object]]:
    _require_local_synthetic(settings)
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        rows = connection.execute(
            "SELECT * FROM local_test_runs ORDER BY requested_at DESC LIMIT %s",
            (min(max(limit, 1), 50),),
        ).fetchall()
    return [_serialize(dict(row)) for row in rows]


def get_test_run(settings: Settings, run_id: UUID) -> dict[str, object]:
    _require_local_synthetic(settings)
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        row = connection.execute("SELECT * FROM local_test_runs WHERE id = %s", (run_id,)).fetchone()
    if not row:
        raise LocalTestRunError("local_test_run_not_found")
    return _serialize(dict(row))


def request_test_run_cancellation(settings: Settings, run_id: UUID, requested_by: UUID) -> dict[str, object]:
    _require_local_synthetic(settings)
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        row = connection.execute(
            """
            UPDATE local_test_runs
            SET status = CASE WHEN status = 'QUEUED' THEN 'CANCELLED' ELSE 'CANCEL_REQUESTED' END,
                stage = CASE WHEN status = 'QUEUED' THEN 'CANCELLED' ELSE stage END,
                completed_at = CASE WHEN status = 'QUEUED' THEN NOW() ELSE completed_at END,
                updated_at = NOW()
            WHERE id = %s AND status IN ('QUEUED', 'RUNNING')
            RETURNING *
            """,
            (run_id,),
        ).fetchone()
        connection.commit()
    if not row:
        raise LocalTestRunError("local_test_run_not_cancellable")
    _operator_audit(settings, requested_by, "TEST_RUN_CANCEL_REQUESTED", {"runId": str(run_id)})
    return _serialize(dict(row))


def list_artifacts(settings: Settings, run_id: UUID) -> list[dict[str, object]]:
    run = get_test_run(settings, run_id)
    if not run["artifactsAvailable"]:
        return []
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        row = connection.execute(
            "SELECT artifact_directory FROM local_test_runs WHERE id = %s",
            (run_id,),
        ).fetchone()
    directory = _validated_artifact_directory(settings, str(row["artifact_directory"]))
    return [
        {"name": path.name, "bytes": path.stat().st_size}
        for path in sorted(directory.iterdir())
        if path.is_file() and path.name in ARTIFACT_NAMES
    ]


def artifact_path(settings: Settings, run_id: UUID, name: str) -> Path:
    if name not in ARTIFACT_NAMES:
        raise LocalTestRunError("local_test_artifact_not_allowed")
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        row = connection.execute(
            "SELECT artifact_directory FROM local_test_runs WHERE id = %s",
            (run_id,),
        ).fetchone()
    if not row or not row["artifact_directory"]:
        raise LocalTestRunError("local_test_artifact_not_found")
    path = _validated_artifact_directory(settings, str(row["artifact_directory"])) / name
    if not path.is_file():
        raise LocalTestRunError("local_test_artifact_not_found")
    return path


def _validated_artifact_directory(settings: Settings, value: str) -> Path:
    allowed_root = (Path(settings.local_data_root) / "exports" / "test-runs").resolve()
    resolved = Path(value).resolve()
    if not resolved.is_relative_to(allowed_root):
        raise LocalTestRunError("local_test_artifact_path_invalid")
    return resolved


def claim_test_run(settings: Settings) -> UUID | None:
    _require_local_synthetic(settings)
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        row = connection.execute(
            """
            SELECT id FROM local_test_runs
            WHERE status = 'QUEUED'
            ORDER BY requested_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            """
        ).fetchone()
        if not row:
            connection.commit()
            return None
        connection.execute(
            """
            UPDATE local_test_runs
            SET status = 'RUNNING', stage = 'PREWARM', progress = 2,
                started_at = COALESCE(started_at, NOW()), updated_at = NOW()
            WHERE id = %s
            """,
            (row["id"],),
        )
        connection.commit()
    return UUID(str(row["id"]))


def recover_interrupted_test_runs(settings: Settings) -> int:
    _require_local_synthetic(settings)
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        rows = connection.execute(
            """
            SELECT id, status FROM local_test_runs
            WHERE status IN ('RUNNING', 'CANCEL_REQUESTED')
            FOR UPDATE
            """
        ).fetchall()
        connection.commit()
    recovered = 0
    for row in rows:
        run_id = UUID(str(row["id"]))
        cleanup_error = None
        try:
            cleanup_acceptance(settings)
            verify_acceptance_cleanup(settings)
        except Exception as error:
            cleanup_error = type(error).__name__
        if cleanup_error:
            _update(
                settings,
                run_id,
                stage="FAILED",
                progress=99,
                status="FAILED",
                report={"recoveredAfterRestart": True, "cleanupError": cleanup_error},
                error_code="local_test_cleanup_failed",
            )
        elif row["status"] == "CANCEL_REQUESTED":
            _update(
                settings,
                run_id,
                stage="CANCELLED",
                progress=100,
                status="CANCELLED",
                report={"recoveredAfterRestart": True},
            )
        else:
            with system_connection(settings.system_database_url) as connection:
                connection.execute(
                    """
                    UPDATE local_test_runs
                    SET status = 'QUEUED', stage = 'RECOVERY', progress = 1,
                        report_json = report_json || '{"recoveredAfterRestart": true}'::jsonb,
                        updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING'
                    """,
                    (run_id,),
                )
                connection.commit()
        recovered += 1
    return recovered


def _update(
    settings: Settings,
    run_id: UUID,
    *,
    stage: str,
    progress: int,
    status: str = "RUNNING",
    report: dict[str, object] | None = None,
    artifact_directory: str | None = None,
    error_code: str | None = None,
) -> None:
    terminal = status in TERMINAL_STATUSES
    with system_connection(settings.system_database_url) as connection:
        connection.execute(
            """
            UPDATE local_test_runs
            SET status = %s, stage = %s, progress = %s,
                report_json = COALESCE(%s, report_json),
                artifact_directory = COALESCE(%s, artifact_directory),
                error_code = %s,
                completed_at = CASE WHEN %s THEN NOW() ELSE completed_at END,
                updated_at = NOW()
            WHERE id = %s
            """,
            (status, stage, progress, json.dumps(report) if report is not None else None,
             artifact_directory, error_code, terminal, run_id),
        )
        connection.commit()


def _cancel_requested(settings: Settings, run_id: UUID) -> bool:
    with system_connection(settings.system_database_url) as connection:
        row = connection.execute("SELECT status FROM local_test_runs WHERE id = %s", (run_id,)).fetchone()
    return bool(row and row[0] == "CANCEL_REQUESTED")


def _device_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-ChallanSe-Device-Timestamp": str(int(time.time())),
        "X-ChallanSe-Nonce": uuid4().hex,
    }


def _upload_acceptance_workload(
    settings: Settings,
    run_id: UUID,
    enrollment_code: str,
    fixtures_directory: Path,
) -> dict[str, object]:
    acknowledgements: list[dict[str, object]] = []
    started_at = time.monotonic()
    with httpx.Client(base_url=settings.local_acceptance_base_url.rstrip("/"), timeout=30.0) as client:
        enrolled = client.post(
            "/v1/devices/enroll",
            json={"enrollmentCode": enrollment_code, "deviceName": "Acceptance Device", "appVersion": "local-console-1"},
        )
        enrolled.raise_for_status()
        token = str(enrolled.json()["deviceToken"])
        bootstrap_response = client.get("/v1/mobile/bootstrap", headers={"Authorization": f"Bearer {token}"})
        bootstrap_response.raise_for_status()
        bootstrap = bootstrap_response.json()
        vendors = [str(vendor["id"]) for vendor in bootstrap["vendors"]]
        fixtures = sorted(fixtures_directory.glob("*.webp"))
        if len(fixtures) != 5 or len(vendors) != 4:
            raise LocalTestRunError("synthetic_fixture_or_vendor_count_invalid")
        for index in range(50):
            if _cancel_requested(settings, run_id):
                raise LocalTestRunError("local_test_run_cancelled")
            image = fixtures[index % len(fixtures)].read_bytes()
            digest = hashlib.sha256(image).hexdigest()
            receipt_id = str(uuid4())
            create_response = client.post(
                "/v1/uploads",
                json={
                    "receiptId": receipt_id,
                    "vendorId": vendors[index % len(vendors)],
                    "capturedAtUnix": int(time.time()),
                    "capturedQuantity": float((index % 20) + 1),
                    "imageSha256": digest,
                    "appVersion": "local-console-1",
                    "configurationVersion": int(bootstrap["configurationVersion"]),
                    "totalBytes": len(image),
                    "mimeType": "image/webp",
                },
                headers=_device_headers(token),
            )
            create_response.raise_for_status()
            session = create_response.json()
            upload_id = str(session["uploadId"])
            part_size = int(session["partSize"])
            for part_number, offset in enumerate(range(0, len(image), part_size)):
                part = image[offset:offset + part_size]
                part_response = client.put(
                    f"/v1/uploads/{upload_id}/parts/{part_number}",
                    content=part,
                    headers={
                        **_device_headers(token),
                        "Content-Type": "application/octet-stream",
                        "X-Part-Sha256": hashlib.sha256(part).hexdigest(),
                    },
                )
                part_response.raise_for_status()
            acknowledgement_started = time.monotonic()
            complete_response = client.post(
                f"/v1/uploads/{upload_id}/complete",
                content=b"",
                headers=_device_headers(token),
            )
            complete_response.raise_for_status()
            acknowledgements.append(
                {
                    "receiptId": receipt_id,
                    "status": complete_response.json()["status"],
                    "acknowledgementMs": round((time.monotonic() - acknowledgement_started) * 1000, 2),
                }
            )
            _update(settings, run_id, stage="UPLOAD", progress=10 + int((index + 1) * 55 / 50))
        deadline = time.monotonic() + 1800
        queue_depth = 50
        _update(settings, run_id, stage="OCR_DRAIN", progress=70)
        while time.monotonic() < deadline:
            if _cancel_requested(settings, run_id):
                raise LocalTestRunError("local_test_run_cancelled")
            status_response = client.get("/v1/local/status")
            status_response.raise_for_status()
            queue_depth = int(status_response.json()["queueDepth"])
            if queue_depth == 0:
                break
            time.sleep(5)
    return {
        "synthetic": True,
        "receiptCount": len(acknowledgements),
        "uniqueReceiptCount": len({item["receiptId"] for item in acknowledgements}),
        "allAcknowledgedBeforeOcrDrain": all(item["status"] == "RECEIVED" for item in acknowledgements),
        "queueDepthAfterWait": queue_depth,
        "elapsedSeconds": round(time.monotonic() - started_at, 2),
        "maxAcknowledgementMs": max(float(item["acknowledgementMs"]) for item in acknowledgements),
        "passed": len(acknowledgements) == 50 and queue_depth == 0,
    }


def _write_evidence(settings: Settings, run_id: UUID, report: dict[str, object], fixtures_directory: Path) -> Path:
    directory = Path(settings.local_data_root) / "exports" / "test-runs" / str(run_id)
    directory.mkdir(parents=True, exist_ok=True)
    runtime = local_status(settings)
    (directory / "acceptance-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (directory / "runtime-status.json").write_text(json.dumps(runtime, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(fixtures_directory / "manifest.json", directory / "fixture-manifest.json")
    (directory / "environment.json").write_text(
        json.dumps(
            {
                "commitSha": settings.local_build_commit_sha,
                "model": settings.ollama_model,
                "tesseractVersion": tesseract_version(),
                "tesseractLanguages": sorted(tesseract_languages()),
                "awsDeploymentFrozen": True,
                "cloudflareRequired": False,
                "uiValidationRecorded": (
                    Path(settings.local_data_root) / "exports" / "ui-validation" / "latest" / "ui-validation.json"
                ).is_file(),
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    (directory / "limitations.txt").write_text(
        "Synthetic demonstration only.\n"
        "No uptime SLA, statutory validation, OCR accuracy claim, or unattended operation.\n"
        "AWS deployment remains frozen and Cloudflare is not required for this LAN test.\n"
        "Real client data is prohibited.\n",
        encoding="utf-8",
    )
    ui_validation = Path(settings.local_data_root) / "exports" / "ui-validation" / "latest"
    for name in ("ui-validation.json", "operator-desktop.png", "operator-mobile.png"):
        source = ui_validation / name
        if source.is_file():
            shutil.copyfile(source, directory / name)
    runtime_manifest = Path(settings.local_data_root) / "exports" / "runtime-manifest.json"
    if runtime_manifest.is_file():
        shutil.copyfile(runtime_manifest, directory / "runtime-manifest.json")
    return directory


def run_claimed_test(settings: Settings, run_id: UUID) -> None:
    _require_local_synthetic(settings)
    fixtures_directory = Path(settings.local_data_root) / "fixtures"
    report: dict[str, object] = {}
    requested_by: UUID | None = None
    try:
        with system_connection(settings.system_database_url) as connection:
            row = connection.execute("SELECT requested_by FROM local_test_runs WHERE id = %s", (run_id,)).fetchone()
            requested_by = UUID(str(row[0])) if row else None
        _update(settings, run_id, stage="PREWARM", progress=3)
        prewarm_local_model(settings)
        if _cancel_requested(settings, run_id):
            raise LocalTestRunError("local_test_run_cancelled")
        _update(settings, run_id, stage="FIXTURES", progress=6)
        generate_local_fixtures(fixtures_directory)
        _update(settings, run_id, stage="PREPARE", progress=8)
        enrollment_code = prepare_acceptance(settings)
        report = _upload_acceptance_workload(settings, run_id, enrollment_code, fixtures_directory)
        if not report["passed"]:
            raise LocalTestRunError("local_test_acceptance_failed")
        _update(settings, run_id, stage="CLEANUP", progress=92, report=report)
        cleanup_acceptance(settings)
        verify_acceptance_cleanup(settings)
        _update(settings, run_id, stage="EVIDENCE", progress=96, report=report)
        directory = _write_evidence(settings, run_id, report, fixtures_directory)
        _update(
            settings,
            run_id,
            stage="PASSED",
            progress=100,
            status="PASSED",
            report=report,
            artifact_directory=str(directory),
        )
        if requested_by:
            _operator_audit(settings, requested_by, "TEST_RUN_PASSED", {"runId": str(run_id)})
    except Exception as error:
        cleanup_error = None
        try:
            cleanup_acceptance(settings)
            verify_acceptance_cleanup(settings)
        except Exception as caught:
            cleanup_error = type(caught).__name__
        cancelled = isinstance(error, LocalTestRunError) and str(error) == "local_test_run_cancelled"
        if cleanup_error:
            error_code = "local_test_cleanup_failed"
        elif isinstance(error, LocalTestRunError):
            error_code = str(error)
        elif isinstance(error, httpx.HTTPStatusError):
            error_code = f"local_test_http_{error.response.status_code}"
        else:
            error_code = f"local_test_{type(error).__name__.lower()}"
        _update(
            settings,
            run_id,
            stage="CANCELLED" if cancelled else "FAILED",
            progress=100 if cancelled else 99,
            status="CANCELLED" if cancelled else "FAILED",
            report={**report, "cleanupError": cleanup_error} if cleanup_error else report,
            error_code=error_code,
        )
        if requested_by:
            _operator_audit(
                settings,
                requested_by,
                "TEST_RUN_CANCELLED" if cancelled else "TEST_RUN_FAILED",
                {"runId": str(run_id), "errorCode": error_code},
            )
