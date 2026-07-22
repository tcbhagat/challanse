from datetime import UTC, datetime

import httpx

from .config import Settings
from .tenancy import system_connection


def probe_ollama(settings: Settings, client: httpx.Client | None = None) -> bool:
    http_client = client or httpx.Client(timeout=3.0)
    owns_client = client is None
    try:
        response = http_client.get(f"{settings.ollama_url.rstrip('/')}/api/tags", timeout=3.0)
        response.raise_for_status()
        model_names = {str(model.get("name", "")) for model in response.json().get("models", [])}
        return settings.ollama_model in model_names
    except (httpx.HTTPError, ValueError, TypeError):
        return False
    finally:
        if owns_client:
            http_client.close()


def record_ollama_health(settings: Settings) -> bool:
    ready = probe_ollama(settings)
    with system_connection(settings.system_database_url or settings.database_url) as connection:
        connection.execute(
            """
            INSERT INTO local_service_health (service_name, status, model_name, checked_at)
            VALUES ('ollama', %s, %s, %s)
            ON CONFLICT (service_name) DO UPDATE SET
              status = excluded.status,
              model_name = excluded.model_name,
              checked_at = excluded.checked_at
            """,
            ("READY" if ready else "UNAVAILABLE", settings.ollama_model, datetime.now(UTC)),
        )
        connection.commit()
    return ready
