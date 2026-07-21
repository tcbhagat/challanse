import json
import sys
from datetime import datetime, timezone
from uuid import uuid4

from psycopg.rows import dict_row

from .config import get_settings
from .tenancy import system_connection


def record_backup(status: str, repository_id: str, snapshot_id: str, manifest_sha256: str) -> None:
    if status not in {"SUCCEEDED", "FAILED", "RESTORE_VERIFIED"}:
        raise RuntimeError("backup_status_invalid")
    settings = get_settings()
    with system_connection(settings.system_database_url) as connection:
        connection.execute(
            """
            INSERT INTO local_backup_runs
              (id, repository_id, snapshot_id, status, manifest_sha256, completed_at, event_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (uuid4(), repository_id, snapshot_id, status, manifest_sha256, datetime.now(timezone.utc), json.dumps({"source": "local-pilot-cli"})),
        )
        connection.commit()


def latest_backup_status() -> dict[str, object]:
    settings = get_settings()
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        row = connection.execute(
            "SELECT status, completed_at, manifest_sha256 FROM local_backup_runs ORDER BY completed_at DESC LIMIT 1"
        ).fetchone()
    if not row:
        return {"status": "MISSING"}
    return {
        "status": str(row["status"]),
        "completedAt": row["completed_at"].isoformat(),
        "manifestSha256": str(row["manifest_sha256"] or ""),
    }


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "record":
        payload = json.loads(sys.stdin.read())
        record_backup(
            str(payload["status"]),
            str(payload["repositoryId"]),
            str(payload["snapshotId"]),
            str(payload["manifestSha256"]),
        )
        return
    if action == "status":
        print(json.dumps(latest_backup_status(), default=str, sort_keys=True))
        return
    raise RuntimeError("backup_action_invalid")


if __name__ == "__main__":
    main()
