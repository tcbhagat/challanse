import os
from uuid import UUID

from psycopg.rows import dict_row

from .authoritative import ReviewerContext, create_enrollment_code
from .config import get_settings
from .local_seed import ORGANIZATION_ID, PRIMARY_REVIEWER, SITE_ID
from .tenancy import system_connection


def create_local_enrollment() -> dict[str, str | int]:
    settings = get_settings()
    if settings.environment != "local-pilot" or not settings.synthetic_mode:
        raise RuntimeError("local_enrollment_requires_synthetic_mode")
    device_name = os.getenv("LOCAL_DEVICE_NAME", "Synthetic Pilot Device").strip()
    with system_connection(settings.database_admin_url, row_factory=dict_row) as connection:
        user = connection.execute("SELECT id FROM users WHERE email = %s AND active", (PRIMARY_REVIEWER,)).fetchone()
    if not user:
        raise RuntimeError("local_pilot_not_seeded")
    reviewer = ReviewerContext(
        user_id=UUID(str(user["id"])),
        organization_id=ORGANIZATION_ID,
        site_id=SITE_ID,
        role="ORG_ADMIN",
        email=PRIMARY_REVIEWER,
        issuer="https://local-pilot.challanse",
        subject=f"local:{PRIMARY_REVIEWER}",
    )
    return create_enrollment_code(settings, reviewer, device_name)


if __name__ == "__main__":
    result = create_local_enrollment()
    print(f"enrollment_code={result['enrollmentCode']} expires_in={result['expiresInSeconds']}")
