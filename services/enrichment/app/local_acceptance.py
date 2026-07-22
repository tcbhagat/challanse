import sys
from uuid import UUID

from psycopg import sql
from psycopg.rows import dict_row

from .authoritative import ReviewerContext, create_enrollment_code
from .bootstrap import BootstrapVendor, TenantBootstrap, bootstrap_tenant
from .config import Settings, get_settings
from .object_store import object_store_client
from .pilot_control import current_pilot_mode
from .tenancy import system_connection


ACCEPTANCE_ORGANIZATION_ID = UUID("10000000-0000-4000-8000-000000000002")
ACCEPTANCE_SITE_ID = UUID("20000000-0000-4000-8000-000000000002")
ACCEPTANCE_REVIEWER_EMAIL = "acceptance@synthetic.invalid"
ACCEPTANCE_ISSUER = "https://local-acceptance.challanse"
ACCEPTANCE_SUBJECT = "local:acceptance"


def _require_synthetic_demo(settings: Settings) -> None:
    if settings.environment != "local-pilot" or not settings.synthetic_mode:
        raise RuntimeError("local_acceptance_requires_synthetic_mode")
    if current_pilot_mode(settings) != "synthetic-demo":
        raise RuntimeError("local_acceptance_forbidden_outside_synthetic_demo")


def _delete_object_prefix(settings: Settings) -> None:
    client = object_store_client(settings)
    continuation_token: str | None = None
    prefix = f"{ACCEPTANCE_ORGANIZATION_ID}/"
    while True:
        request: dict[str, object] = {"Bucket": settings.receipt_bucket, "Prefix": prefix}
        if continuation_token:
            request["ContinuationToken"] = continuation_token
        response = client.list_objects_v2(**request)
        objects = [{"Key": item["Key"]} for item in response.get("Contents", [])]
        if objects:
            client.delete_objects(Bucket=settings.receipt_bucket, Delete={"Objects": objects, "Quiet": True})
        if not response.get("IsTruncated"):
            return
        continuation_token = str(response["NextContinuationToken"])


def cleanup_acceptance(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    _require_synthetic_demo(settings)
    _delete_object_prefix(settings)
    with system_connection(settings.database_admin_url) as connection:
        user_ids = [
            row[0]
            for row in connection.execute(
                "SELECT user_id FROM identity_links WHERE issuer = %s AND subject = %s",
                (ACCEPTANCE_ISSUER, ACCEPTANCE_SUBJECT),
            ).fetchall()
        ]
        for table in (
            "audit_events",
            "immutable_enrichment_audits",
            "workflow_stages",
            "verified_receipts",
            "local_receipt_queue",
            "transactional_outbox",
            "enrichment_receipts",
            "receipts",
            "upload_parts",
            "upload_sessions",
            "tally_import_rows",
            "tally_imports",
            "notification_digests",
            "retention_tombstones",
            "service_ingress_requests",
            "site_integration_profiles",
            "site_managers",
            "telemetry_measurements",
            "nightly_friction_reports",
            "vendor_integration_profiles",
        ):
            connection.execute(
                sql.SQL("DELETE FROM {} WHERE organization_id = %s").format(sql.Identifier(table)),
                (ACCEPTANCE_ORGANIZATION_ID,),
            )
        connection.execute("DELETE FROM organizations WHERE id = %s", (ACCEPTANCE_ORGANIZATION_ID,))
        for user_id in user_ids:
            connection.execute("DELETE FROM users WHERE id = %s", (user_id,))
        connection.commit()


def verify_acceptance_cleanup(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    _require_synthetic_demo(settings)
    with system_connection(settings.database_admin_url) as connection:
        present = connection.execute(
            "SELECT EXISTS (SELECT 1 FROM organizations WHERE id = %s)",
            (ACCEPTANCE_ORGANIZATION_ID,),
        ).fetchone()[0]
    objects = object_store_client(settings).list_objects_v2(
        Bucket=settings.receipt_bucket,
        Prefix=f"{ACCEPTANCE_ORGANIZATION_ID}/",
        MaxKeys=1,
    ).get("Contents", [])
    if present or objects:
        raise RuntimeError("local_acceptance_cleanup_incomplete")


def prepare_acceptance(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    _require_synthetic_demo(settings)
    cleanup_acceptance(settings)
    bootstrap_tenant(
        settings,
        TenantBootstrap(
            organization_id=ACCEPTANCE_ORGANIZATION_ID,
            organization_slug="synthetic-acceptance",
            organization_name="Synthetic Acceptance Workload",
            site_id=ACCEPTANCE_SITE_ID,
            site_name="Synthetic Acceptance Site",
            allowed_wifi_ssids=["SYNTHETIC-ACCEPTANCE-WIFI"],
            reviewer_issuer=ACCEPTANCE_ISSUER,
            reviewer_subject=ACCEPTANCE_SUBJECT,
            reviewer_email=ACCEPTANCE_REVIEWER_EMAIL,
            reviewer_display_name="Synthetic Acceptance Runner",
            vendors=[
                BootstrapVendor(id="accept-cement", name="Acceptance Cement", initials="AC", color="#F59E0B"),
                BootstrapVendor(id="accept-steel", name="Acceptance Steel", initials="AS", color="#0F766E"),
                BootstrapVendor(id="accept-sand", name="Acceptance Sand", initials="AM", color="#2563EB"),
                BootstrapVendor(id="accept-brick", name="Acceptance Brick", initials="AB", color="#DC2626"),
            ],
            confirmation=f"BOOTSTRAP {ACCEPTANCE_ORGANIZATION_ID}",
        ),
    )
    with system_connection(settings.database_admin_url, row_factory=dict_row) as connection:
        user = connection.execute(
            "SELECT user_id FROM identity_links WHERE issuer = %s AND subject = %s",
            (ACCEPTANCE_ISSUER, ACCEPTANCE_SUBJECT),
        ).fetchone()
    if not user:
        raise RuntimeError("local_acceptance_reviewer_missing")
    reviewer = ReviewerContext(
        user_id=UUID(str(user["user_id"])),
        organization_id=ACCEPTANCE_ORGANIZATION_ID,
        site_id=ACCEPTANCE_SITE_ID,
        role="ORG_ADMIN",
        email=ACCEPTANCE_REVIEWER_EMAIL,
        issuer=ACCEPTANCE_ISSUER,
        subject=ACCEPTANCE_SUBJECT,
    )
    return str(create_enrollment_code(settings, reviewer, "Acceptance Device")["enrollmentCode"])


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "prepare":
        print(f"enrollment_code={prepare_acceptance()}")
        return 0
    if command == "cleanup":
        cleanup_acceptance()
        print("local_acceptance_cleanup_completed")
        return 0
    if command == "verify-clean":
        verify_acceptance_cleanup()
        print("local_acceptance_cleanup_verified")
        return 0
    raise RuntimeError("local_acceptance_command_invalid")


if __name__ == "__main__":
    raise SystemExit(main())
