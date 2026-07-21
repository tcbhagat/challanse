import hashlib
import json
from typing import Any

from psycopg.rows import dict_row

from .tenancy import system_connection


def audit_event_hash(previous_hash: str, event: dict[str, Any]) -> str:
    canonical = json.dumps(event, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{previous_hash}:{canonical}".encode()).hexdigest()


def verify_audit_chains(database_url: str) -> dict[str, object]:
    with system_connection(database_url, row_factory=dict_row) as connection:
        rows = connection.execute(
            """
            SELECT organization_id, site_id, event_json, previous_hash, event_hash
            FROM audit_events
            ORDER BY organization_id, site_id, created_at, id
            """
        ).fetchall()
    previous_by_chain: dict[tuple[str, str], str] = {}
    checked = 0
    for row in rows:
        chain = (str(row["organization_id"]), str(row["site_id"]))
        expected_previous = previous_by_chain.get(chain, "")
        stored_previous = str(row["previous_hash"] or "")
        expected_hash = audit_event_hash(expected_previous, dict(row["event_json"]))
        if stored_previous != expected_previous or str(row["event_hash"]) != expected_hash:
            return {"valid": False, "eventsChecked": checked, "failedChain": ":".join(chain)}
        previous_by_chain[chain] = expected_hash
        checked += 1
    return {"valid": True, "eventsChecked": checked, "chainsChecked": len(previous_by_chain)}
