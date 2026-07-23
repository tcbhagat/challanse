import threading

import httpx

from .config import Settings


SAFE_GUIDANCE = {
    "storage_not_mounted": "Open encrypted storage in the terminal, verify the mapper mount, then start the stack.",
    "lan_ip_changed": "Stop the stack and use the guarded LAN refresh command before restarting.",
    "certificate_invalid": "Do not bypass the warning. Reissue the local pilot certificate with the guarded CLI.",
    "ollama_unavailable": "Verify the Ollama container and approved qwen2.5:7b model, then prewarm it.",
    "tesseract_unavailable": "Verify the container OCR languages include eng and hin before testing.",
    "queue_stalled": "Inspect worker health and terminal failures; do not start another acceptance run.",
    "test_run_active": "Wait for the active run or request safe cancellation at a stage boundary.",
    "acceptance_cleanup_failed": "Stop testing and preserve evidence. Do not use the run for acceptance.",
    "storage_warning": "Export evidence and remove expired synthetic artifacts before additional uploads.",
    "android_device_missing": "Reconnect USB, unlock the device, approve debugging, and rerun adb devices.",
    "browser_test_failed": "Open the Playwright trace and first failing screenshot before changing code.",
}
_explanation_lock = threading.Lock()


class LocalDiagnosticError(RuntimeError):
    pass


def explain_safe_code(settings: Settings, code: str) -> dict[str, str | bool]:
    if settings.environment != "local-pilot" or not settings.synthetic_mode:
        raise LocalDiagnosticError("local_diagnostics_unavailable")
    deterministic = SAFE_GUIDANCE.get(code)
    if not deterministic:
        raise LocalDiagnosticError("diagnostic_code_not_allowed")
    if not _explanation_lock.acquire(blocking=False):
        return {"code": code, "guidance": deterministic, "advisory": "", "modelAvailable": False}
    try:
        prompt = (
            "You are explaining one allowlisted ChallanSe local-pilot health code. "
            "Do not invent causes, commands, credentials, paths, or successful outcomes. "
            "Use at most three short sentences. State that the deterministic guidance is authoritative.\n"
            f"Code: {code}\nDeterministic guidance: {deterministic}"
        )
        try:
            response = httpx.post(
                f"{settings.ollama_url.rstrip('/')}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "keep_alive": "30m",
                    "options": {"temperature": 0, "num_predict": 120},
                },
                timeout=min(settings.ollama_timeout_seconds, 45.0),
            )
            response.raise_for_status()
            advisory = str(response.json().get("response") or "").strip()[:1_500]
            return {"code": code, "guidance": deterministic, "advisory": advisory, "modelAvailable": True}
        except Exception:
            return {"code": code, "guidance": deterministic, "advisory": "", "modelAvailable": False}
    finally:
        _explanation_lock.release()
