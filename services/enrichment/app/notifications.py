from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class DigestReceipt:
    manager_id: str
    failed_to_read: bool


def aggregate_digests(receipts: list[DigestReceipt], dashboard_url: str) -> dict[str, str]:
    grouped: dict[str, list[DigestReceipt]] = defaultdict(list)
    for receipt in receipts:
        grouped[receipt.manager_id].append(receipt)
    return {
        manager_id: (
            f"Daily Gate Log: {len(items)} receipts scanned. "
            f"{sum(item.failed_to_read for item in items)} failed to read. View dashboard: {dashboard_url}"
        )
        for manager_id, items in grouped.items()
    }
