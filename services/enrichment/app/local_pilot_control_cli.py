import json
import sys

from .config import get_settings
from .pilot_control import (
    activate_controlled_pilot,
    end_controlled_pilot,
    prepare_client_configuration,
    purge_ended_pilot,
)


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    settings = get_settings()
    if action == "prepare":
        raw = sys.stdin.buffer.read()
        result = prepare_client_configuration(settings, raw, "PREPARE CONTROLLED CLIENT PILOT")
        print(json.dumps(result, sort_keys=True))
        return
    if action == "activate":
        payload = json.loads(sys.stdin.read())
        activate_controlled_pilot(
            settings,
            operator_email=str(payload["operatorEmail"]),
            retention_days=int(payload["retentionDays"]),
            client_approval_sha256=str(payload["clientApprovalSha256"]),
            security_review_sha256=str(payload["securityReviewSha256"]),
            backup_restore_sha256=str(payload["backupRestoreSha256"]),
            confirmation="ACTIVATE CONTROLLED CLIENT PILOT",
        )
        print('{"status":"controlled-client-pilot"}')
        return
    if action == "end":
        payload = json.loads(sys.stdin.read())
        end_controlled_pilot(
            settings,
            operator_email=str(payload["operatorEmail"]),
            confirmation="END CONTROLLED CLIENT PILOT",
        )
        print('{"status":"ended-retention-active"}')
        return
    if action == "purge-ended":
        purge_ended_pilot(settings, confirmation="PURGE ENDED CLIENT PILOT")
        print('{"status":"client-data-purged"}')
        return
    raise RuntimeError("local_pilot_control_action_invalid")


if __name__ == "__main__":
    main()
