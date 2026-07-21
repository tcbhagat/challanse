import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from psycopg.rows import dict_row
from pydantic import BaseModel, Field, field_validator, model_validator

from .bootstrap import BootstrapVendor, TenantBootstrap, bootstrap_tenant
from .config import Settings
from .tenancy import system_connection


SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
SYNTHETIC_ORGANIZATION_ID = UUID("10000000-0000-4000-8000-000000000001")


class PilotControlError(RuntimeError):
    pass


class ClientReviewer(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(min_length=1, max_length=120)
    role: Literal["CONTROLLER", "REVIEWER"]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized:
            raise ValueError("email_invalid")
        return normalized


class ClientVendor(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,39}$")
    name: str = Field(min_length=1, max_length=120)
    initials: str = Field(pattern=r"^[A-Z0-9]{1,3}$")
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class ClientPilotConfiguration(BaseModel):
    organization_id: UUID
    organization_slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,49}$")
    legal_name: str = Field(min_length=2, max_length=160)
    site_id: UUID
    site_name: str = Field(min_length=2, max_length=160)
    allowed_wifi_ssids: list[str] = Field(min_length=1, max_length=5)
    reviewers: list[ClientReviewer] = Field(min_length=2, max_length=2)
    vendors: list[ClientVendor] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_controlled_scope(self):
        if self.organization_id == SYNTHETIC_ORGANIZATION_ID or self.organization_slug == "synthetic-client":
            raise ValueError("synthetic_identity_forbidden")
        if len({reviewer.email for reviewer in self.reviewers}) != 2:
            raise ValueError("reviewer_emails_must_be_unique")
        if sum(reviewer.role == "CONTROLLER" for reviewer in self.reviewers) != 1:
            raise ValueError("exactly_one_controller_required")
        if len(set(self.allowed_wifi_ssids)) != len(self.allowed_wifi_ssids):
            raise ValueError("wifi_ssids_must_be_unique")
        return self


def current_pilot_mode(settings: Settings) -> str:
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        row = connection.execute("SELECT mode FROM local_pilot_control WHERE singleton").fetchone()
    return str(row["mode"]) if row else "synthetic-demo"


def require_capture_enabled(settings: Settings) -> None:
    if settings.environment != "local-pilot":
        return
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        control = connection.execute("SELECT mode, ended_at FROM local_pilot_control WHERE singleton").fetchone()
    if control and control["mode"] == "controlled-client-pilot" and control["ended_at"] is not None:
        raise PilotControlError("controlled_client_pilot_ended")


def prepare_client_configuration(settings: Settings, raw_configuration: bytes, confirmation: str) -> dict[str, str]:
    if settings.environment != "local-pilot" or not settings.synthetic_mode:
        raise PilotControlError("local_pilot_environment_required")
    if confirmation != "PREPARE CONTROLLED CLIENT PILOT":
        raise PilotControlError("client_preparation_confirmation_invalid")
    configuration = ClientPilotConfiguration.model_validate_json(raw_configuration)
    with system_connection(settings.database_admin_url, row_factory=dict_row) as connection:
        control = connection.execute("SELECT mode FROM local_pilot_control WHERE singleton FOR UPDATE").fetchone()
        if not control or control["mode"] != "synthetic-demo":
            raise PilotControlError("pilot_mode_not_synthetic")
        real_receipts = connection.execute(
            "SELECT COUNT(*) AS count FROM receipts WHERE organization_id <> %s",
            (SYNTHETIC_ORGANIZATION_ID,),
        ).fetchone()
        if int(real_receipts["count"] or 0) > 0:
            raise PilotControlError("existing_client_receipts_forbid_preparation")
        connection.execute("DELETE FROM local_reviewer_sessions")
        connection.execute("DELETE FROM local_reviewer_credentials")
        connection.execute("DELETE FROM local_auth_events")
        connection.execute("DELETE FROM organizations")
        connection.execute("DELETE FROM users")
        connection.commit()
    controller = next(reviewer for reviewer in configuration.reviewers if reviewer.role == "CONTROLLER")
    bootstrap_tenant(
        settings,
        TenantBootstrap(
            organization_id=configuration.organization_id,
            organization_slug=configuration.organization_slug,
            organization_name=configuration.legal_name,
            site_id=configuration.site_id,
            site_name=configuration.site_name,
            allowed_wifi_ssids=configuration.allowed_wifi_ssids,
            reviewer_issuer="https://local-pilot.challanse",
            reviewer_subject=f"local:{controller.email}",
            reviewer_email=controller.email,
            reviewer_display_name=controller.display_name,
            vendors=[
                BootstrapVendor(id=vendor.id, name=vendor.name, initials=vendor.initials, color=vendor.color)
                for vendor in configuration.vendors
            ],
            confirmation=f"BOOTSTRAP {configuration.organization_id}",
        ),
    )
    for reviewer in configuration.reviewers:
        if reviewer.email == controller.email:
            continue
        user_id = uuid5(NAMESPACE_URL, f"challanse-local-reviewer:{reviewer.email}")
        identity_id = uuid5(NAMESPACE_URL, f"challanse-local-identity:{reviewer.email}")
        with system_connection(settings.database_admin_url) as connection:
            connection.execute(
                "INSERT INTO users (id, email, display_name, active) VALUES (%s, %s, %s, TRUE)",
                (user_id, reviewer.email, reviewer.display_name),
            )
            connection.execute(
                "INSERT INTO identity_links (id, user_id, issuer, subject, email) VALUES (%s, %s, 'https://local-pilot.challanse', %s, %s)",
                (identity_id, user_id, f"local:{reviewer.email}", reviewer.email),
            )
            connection.execute(
                "INSERT INTO organization_memberships (organization_id, user_id, role, active) VALUES (%s, %s, %s, TRUE)",
                (configuration.organization_id, user_id, reviewer.role),
            )
            connection.execute(
                "INSERT INTO site_memberships (organization_id, site_id, user_id, role, active) VALUES (%s, %s, %s, %s, TRUE)",
                (configuration.organization_id, configuration.site_id, user_id, reviewer.role),
            )
            connection.commit()
    digest = hashlib.sha256(raw_configuration).hexdigest()
    with system_connection(settings.system_database_url) as connection:
        connection.execute(
            "UPDATE local_pilot_control SET client_configuration_sha256 = %s, activated_at = NULL, activated_by = NULL, updated_at = NOW() WHERE singleton",
            (digest,),
        )
        connection.commit()
    return {"organizationId": str(configuration.organization_id), "siteId": str(configuration.site_id), "configurationSha256": digest}


def activation_readiness(settings: Settings) -> dict[str, object]:
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        control = connection.execute("SELECT * FROM local_pilot_control WHERE singleton").fetchone()
        organizations = connection.execute("SELECT COUNT(*) AS count FROM organizations WHERE active").fetchone()
        synthetic = connection.execute("SELECT COUNT(*) AS count FROM organizations WHERE id = %s", (SYNTHETIC_ORGANIZATION_ID,)).fetchone()
        reviewers = connection.execute(
            "SELECT COUNT(*) AS count FROM local_reviewer_credentials WHERE enabled AND totp_secret_ciphertext IS NOT NULL"
        ).fetchone()
        restore = connection.execute(
            "SELECT completed_at FROM local_backup_runs WHERE status = 'RESTORE_VERIFIED' ORDER BY completed_at DESC LIMIT 1"
        ).fetchone()
        backup = connection.execute(
            "SELECT completed_at FROM local_backup_runs WHERE status = 'SUCCEEDED' ORDER BY completed_at DESC LIMIT 1"
        ).fetchone()
    restore_fresh = bool(restore and restore["completed_at"] >= datetime.now(timezone.utc) - timedelta(days=30))
    backup_fresh = bool(backup and backup["completed_at"] >= datetime.now(timezone.utc) - timedelta(hours=24))
    checks = {
        "singleActiveOrganization": int(organizations["count"] or 0) == 1,
        "syntheticOrganizationRemoved": int(synthetic["count"] or 0) == 0,
        "twoMfaReviewers": int(reviewers["count"] or 0) == 2,
        "clientConfigurationRecorded": bool(control and control["client_configuration_sha256"]),
        "restoreVerifiedWithin30Days": restore_fresh,
        "encryptedBackupWithin24Hours": backup_fresh,
    }
    return {"ready": all(checks.values()), "checks": checks, "mode": control["mode"] if control else "synthetic-demo"}


def activate_controlled_pilot(
    settings: Settings,
    *,
    operator_email: str,
    retention_days: int,
    client_approval_sha256: str,
    security_review_sha256: str,
    backup_restore_sha256: str,
    confirmation: str,
) -> None:
    if confirmation != "ACTIVATE CONTROLLED CLIENT PILOT":
        raise PilotControlError("activation_confirmation_invalid")
    hashes = (client_approval_sha256, security_review_sha256, backup_restore_sha256)
    if not all(SHA256_PATTERN.fullmatch(value) for value in hashes):
        raise PilotControlError("activation_evidence_hash_invalid")
    if not 1 <= retention_days <= 30:
        raise PilotControlError("retention_days_invalid")
    readiness = activation_readiness(settings)
    if not readiness["ready"]:
        raise PilotControlError("activation_readiness_failed:" + json.dumps(readiness["checks"], sort_keys=True))
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        operator = connection.execute("SELECT id FROM users WHERE LOWER(email) = %s AND active", (operator_email.lower(),)).fetchone()
        if not operator:
            raise PilotControlError("activation_operator_not_found")
        result = connection.execute(
            """
            UPDATE local_pilot_control SET
              mode = 'controlled-client-pilot', retention_days = %s,
              client_approval_sha256 = %s, security_review_sha256 = %s,
              backup_restore_sha256 = %s, activated_at = NOW(), activated_by = %s, updated_at = NOW()
            WHERE singleton AND mode = 'synthetic-demo'
            RETURNING mode
            """,
            (retention_days, client_approval_sha256, security_review_sha256, backup_restore_sha256, operator["id"]),
        ).fetchone()
        if not result:
            raise PilotControlError("pilot_already_activated")
        connection.commit()


def end_controlled_pilot(settings: Settings, *, operator_email: str, confirmation: str) -> None:
    if confirmation != "END CONTROLLED CLIENT PILOT":
        raise PilotControlError("end_confirmation_invalid")
    with system_connection(settings.system_database_url, row_factory=dict_row) as connection:
        operator = connection.execute(
            "SELECT id FROM users WHERE LOWER(email) = %s AND active",
            (operator_email.strip().lower(),),
        ).fetchone()
        if not operator:
            raise PilotControlError("end_operator_not_found")
        result = connection.execute(
            """
            UPDATE local_pilot_control SET ended_at = NOW(), ended_by = %s, updated_at = NOW()
            WHERE singleton AND mode = 'controlled-client-pilot' AND ended_at IS NULL
            RETURNING ended_at
            """,
            (operator["id"],),
        ).fetchone()
        if not result:
            raise PilotControlError("pilot_not_active_or_already_ended")
        connection.commit()


def purge_ended_pilot(settings: Settings, *, confirmation: str) -> None:
    if confirmation != "PURGE ENDED CLIENT PILOT":
        raise PilotControlError("purge_confirmation_invalid")
    with system_connection(settings.database_admin_url, row_factory=dict_row) as connection:
        control = connection.execute("SELECT * FROM local_pilot_control WHERE singleton FOR UPDATE").fetchone()
        if not control or control["mode"] != "controlled-client-pilot" or not control["ended_at"]:
            raise PilotControlError("ended_pilot_required")
        delete_after = control["ended_at"] + timedelta(days=int(control["retention_days"]))
        if datetime.now(timezone.utc) < delete_after:
            raise PilotControlError(f"retention_period_active_until:{delete_after.isoformat()}")
        connection.execute("DELETE FROM organizations")
        connection.execute(
            """
            UPDATE local_pilot_control SET mode = 'synthetic-demo', client_approval_sha256 = NULL,
              security_review_sha256 = NULL, backup_restore_sha256 = NULL,
              client_configuration_sha256 = NULL, activated_at = NULL, activated_by = NULL,
              ended_at = NULL, ended_by = NULL, updated_at = NOW()
            WHERE singleton
            """
        )
        connection.commit()
