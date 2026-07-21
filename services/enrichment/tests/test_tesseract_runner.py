from pathlib import Path

import pytest

from app import tesseract_runner
from app.tesseract_runner import TesseractExecutionError, run_tesseract, validate_languages


@pytest.mark.parametrize("value", ["eng;id", "eng+../../bin/sh", "eng hin", "ENG", "eng\x00hin", ""])
def test_tesseract_languages_reject_injection(value: str) -> None:
    with pytest.raises(TesseractExecutionError, match="tesseract_languages_invalid"):
        validate_languages(value)


def test_tesseract_languages_accept_fixed_iso_codes() -> None:
    assert validate_languages("eng+hin") == "eng+hin"


def test_tesseract_runner_uses_absolute_binary_without_shell(monkeypatch, tmp_path: Path) -> None:
    binary = tmp_path / "tesseract"
    binary.write_text("test", encoding="utf-8")
    binary.chmod(0o700)
    monkeypatch.setattr(tesseract_runner, "TESSERACT_BINARY", binary)
    captured = {}

    class Completed:
        stdout = b"tesseract 5\n"
        stderr = b""

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return Completed()

    monkeypatch.setattr(tesseract_runner.subprocess, "run", fake_run)
    result = run_tesseract(("--version",), timeout_seconds=5)
    assert result.stdout == "tesseract 5\n"
    assert captured["command"] == [str(binary), "--version"]
    assert captured["kwargs"]["shell"] is False


def test_tesseract_runner_rejects_writable_binary(monkeypatch, tmp_path: Path) -> None:
    binary = tmp_path / "tesseract"
    binary.write_text("test", encoding="utf-8")
    binary.chmod(0o722)
    monkeypatch.setattr(tesseract_runner, "TESSERACT_BINARY", binary)
    with pytest.raises(TesseractExecutionError, match="tesseract_binary_unsafe"):
        run_tesseract(("--version",), timeout_seconds=5)


def test_tesseract_runner_rejects_oversized_output(monkeypatch, tmp_path: Path) -> None:
    binary = tmp_path / "tesseract"
    binary.write_text("test", encoding="utf-8")
    binary.chmod(0o700)
    monkeypatch.setattr(tesseract_runner, "TESSERACT_BINARY", binary)

    class Completed:
        stdout = b"x" * 11
        stderr = b""

    monkeypatch.setattr(tesseract_runner.subprocess, "run", lambda *_args, **_kwargs: Completed())
    with pytest.raises(TesseractExecutionError, match="tesseract_output_too_large"):
        run_tesseract(("--version",), timeout_seconds=5, max_output_bytes=10)
