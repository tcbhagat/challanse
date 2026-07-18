import shutil
from pathlib import Path

from .config import Settings


def local_storage_percent(settings: Settings) -> float:
    usage = shutil.disk_usage(Path(settings.local_data_root))
    return (usage.used / settings.local_storage_limit_bytes) * 100


def local_uploads_paused(settings: Settings) -> bool:
    return settings.synthetic_mode and local_storage_percent(settings) >= 90
