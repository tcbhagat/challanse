from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CHALLANSE_", case_sensitive=True)
    environment: str = "development"
    service_role: str = "api"
    project_id: str = "challanse-staging"
    upload_bucket: str = ""
    accepted_bucket: str = ""
    backup_bucket: str = ""
    task_queue: str = "invoice-ocr"
    task_location: str = "asia-south1"
    task_worker_url: str = ""
    task_service_account: str = ""
    firebase_web_app_id: str = ""
    require_app_check: bool = True
    global_daily_limit: int = 550
    monthly_budget_inr: int = 1000
    consent_version: str = "2026-08-09"
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_plan_id: str = ""
    razorpay_webhook_secret: str = ""

settings = Settings()
