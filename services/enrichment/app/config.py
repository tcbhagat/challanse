from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = Field(default="development", alias="ENVIRONMENT")
    database_url: str = Field(default="", alias="DATABASE_URL")
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    cloudflare_api_url: str = Field(default="", alias="CLOUDFLARE_API_URL")
    cloudflare_shared_secret: str = Field(default="", alias="CLOUDFLARE_SHARED_SECRET")
    ocr_provider: Literal["disabled", "mock", "textract"] = Field(default="disabled", alias="OCR_PROVIDER")
    gst_provider: Literal["disabled", "mock", "http"] = Field(default="disabled", alias="GST_PROVIDER")
    notification_provider: Literal["disabled", "mock", "whatsapp"] = Field(default="disabled", alias="NOTIFICATION_PROVIDER")
    credit_provider: Literal["disabled", "mock", "sqs"] = Field(default="disabled", alias="CREDIT_PROVIDER")
    slack_provider: Literal["disabled", "mock", "webhook"] = Field(default="disabled", alias="SLACK_PROVIDER")
    event_queue_provider: Literal["disabled", "memory", "celery"] = Field(default="disabled", alias="EVENT_QUEUE_PROVIDER")
    gst_api_url: str = Field(default="https://mock-gst-portal.in/api/irn", alias="GST_API_URL")
    gst_timeout_seconds: float = Field(default=3.0, alias="GST_TIMEOUT_SECONDS")
    otel_service_name: str = Field(default="challanse-enrichment", alias="OTEL_SERVICE_NAME")
    otel_exporter_otlp_endpoint: str = Field(default="", alias="OTEL_EXPORTER_OTLP_ENDPOINT")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
