import os
import re
# This module is the isolated fixed-binary boundary; shell execution is prohibited.
import subprocess  # nosec B404
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


TESSERACT_BINARY = Path("/usr/bin/tesseract")
LANGUAGE_PATTERN = re.compile(r"^[a-z]{3}(?:\+[a-z]{3})*$")
MAX_OUTPUT_BYTES = 8_000_000


class TesseractExecutionError(RuntimeError):
    pass


@dataclass(frozen=True)
class TesseractResult:
    stdout: str
    stderr: str


def validate_languages(languages: str) -> str:
    if not LANGUAGE_PATTERN.fullmatch(languages):
        raise TesseractExecutionError("tesseract_languages_invalid")
    return languages


def _validated_binary() -> str:
    if not TESSERACT_BINARY.is_absolute() or not TESSERACT_BINARY.is_file():
        raise TesseractExecutionError("tesseract_binary_unavailable")
    mode = TESSERACT_BINARY.stat().st_mode
    if mode & 0o022 or not os.access(TESSERACT_BINARY, os.X_OK):
        raise TesseractExecutionError("tesseract_binary_unsafe")
    return str(TESSERACT_BINARY)


def run_tesseract(arguments: Sequence[str], *, timeout_seconds: int, max_output_bytes: int = MAX_OUTPUT_BYTES) -> TesseractResult:
    if not arguments or any(not isinstance(value, str) or "\x00" in value for value in arguments):
        raise TesseractExecutionError("tesseract_arguments_invalid")
    try:
        # The binary is absolute, shell is disabled, and callers use fixed validated templates.
        completed = subprocess.run(  # nosec B603
            [_validated_binary(), *arguments],
            capture_output=True,
            text=False,
            timeout=timeout_seconds,
            check=True,
            shell=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise TesseractExecutionError(f"tesseract_{type(error).__name__}") from error
    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        raise TesseractExecutionError("tesseract_output_too_large")
    return TesseractResult(
        stdout=completed.stdout.decode("utf-8", errors="replace"),
        stderr=completed.stderr.decode("utf-8", errors="replace"),
    )


def tesseract_version() -> str:
    output = run_tesseract(("--version",), timeout_seconds=10, max_output_bytes=64_000).stdout
    return output.splitlines()[0].strip() if output.splitlines() else "unavailable"


def tesseract_languages() -> set[str]:
    output = run_tesseract(("--list-langs",), timeout_seconds=10, max_output_bytes=64_000).stdout
    return {line.strip() for line in output.splitlines()[1:] if line.strip()}
