from dataclasses import dataclass


@dataclass(frozen=True)
class SiteMetric:
    site_id: str
    value: float


def threshold_alerts(write_latency_ms: list[SiteMetric], sync_failure_rate: list[SiteMetric], vendor_ocr: list[SiteMetric]) -> list[str]:
    alerts = [f"UI_LAG site={metric.site_id} average_ms={metric.value:.1f}" for metric in write_latency_ms if metric.value > 100]
    alerts.extend(f"SYNC_FAILURE site={metric.site_id} rate={metric.value:.1%}" for metric in sync_failure_rate if metric.value > 0.2)
    alerts.extend(f"OCR_FORMAT_CHANGE vendor={metric.site_id} confidence={metric.value:.1f}" for metric in vendor_ocr if metric.value < 70)
    return alerts
