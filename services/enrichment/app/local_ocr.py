import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .config import Settings


NORMALIZED_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "vendor": {"type": ["string", "null"]},
        "challan_number": {"type": ["string", "null"]},
        "material": {"type": ["string", "null"]},
        "quantity": {"type": ["number", "null"]},
        "unit": {"type": ["string", "null"]},
    },
    "required": ["vendor", "challan_number", "material", "quantity", "unit"],
}


@dataclass(frozen=True)
class LocalOcrOutput:
    raw_text: str
    confidence: float
    normalized: dict[str, Any]
    tesseract_version: str
    model_version: str
    warnings: list[str]


def _tesseract_version() -> str:
    result = subprocess.run(
        ["tesseract", "--version"], capture_output=True, text=True, timeout=10, check=True
    )
    return result.stdout.splitlines()[0].strip()


def extract_text(png_bytes: bytes, languages: str) -> tuple[str, float, str]:
    with tempfile.TemporaryDirectory(prefix="challanse-ocr-") as directory:
        image_path = Path(directory) / "receipt.png"
        image_path.write_bytes(png_bytes)
        result = subprocess.run(
            ["tesseract", str(image_path), "stdout", "-l", languages, "tsv"],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
    words: list[str] = []
    confidences: list[float] = []
    for index, line in enumerate(result.stdout.splitlines()):
        if index == 0 or not line.strip():
            continue
        columns = line.split("\t")
        if len(columns) < 12:
            continue
        word = columns[11].strip()
        try:
            confidence = float(columns[10])
        except ValueError:
            continue
        if word and confidence >= 0:
            words.append(word)
            confidences.append(confidence)
    return " ".join(words), (sum(confidences) / len(confidences) if confidences else 0.0), _tesseract_version()


def _traceable_text(value: str | None, raw_text: str) -> bool:
    if value is None:
        return True
    normalized_value = re.sub(r"\s+", " ", value).strip().casefold()
    normalized_raw = re.sub(r"\s+", " ", raw_text).casefold()
    return bool(normalized_value) and normalized_value in normalized_raw


def _traceable_quantity(value: float | None, raw_text: str) -> bool:
    if value is None:
        return True
    numbers = []
    for match in re.findall(r"(?<![\w.])-?\d+(?:[.,]\d+)?", raw_text):
        try:
            numbers.append(float(match.replace(",", "")))
        except ValueError:
            continue
    return any(abs(number - value) <= max(0.001, abs(value) * 0.0001) for number in numbers)


def validate_normalized(value: Any, raw_text: str) -> tuple[dict[str, Any], list[str]]:
    output = {key: None for key in NORMALIZED_SCHEMA["properties"]}
    warnings: list[str] = []
    if not isinstance(value, dict) or set(value) != set(output):
        return output, ["normalization_schema_invalid"]
    for field in ("vendor", "challan_number", "material", "unit"):
        candidate = value.get(field)
        if candidate is not None and not isinstance(candidate, str):
            warnings.append(f"{field}_type_invalid")
        elif not _traceable_text(candidate, raw_text):
            warnings.append(f"{field}_untraceable")
        else:
            output[field] = candidate.strip() if isinstance(candidate, str) else None
    quantity = value.get("quantity")
    if quantity is not None and (isinstance(quantity, bool) or not isinstance(quantity, (int, float))):
        warnings.append("quantity_type_invalid")
    elif quantity is not None and not _traceable_quantity(float(quantity), raw_text):
        warnings.append("quantity_untraceable")
    else:
        output["quantity"] = float(quantity) if quantity is not None else None
    return output, warnings


def normalize_text(settings: Settings, raw_text: str, client: httpx.Client | None = None) -> tuple[dict[str, Any], str, list[str]]:
    owned_client = client is None
    http_client = client or httpx.Client(timeout=settings.ollama_timeout_seconds)
    prompt = (
        "Extract only values explicitly present in the OCR text. "
        "Return null for missing or uncertain fields. Do not infer, translate, calculate, or correct values.\n\n"
        f"OCR text:\n{raw_text}"
    )
    try:
        response = http_client.post(
            f"{settings.ollama_url.rstrip('/')}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": prompt,
                "format": NORMALIZED_SCHEMA,
                "stream": False,
                "keep_alive": "30m",
                "options": {"temperature": 0, "num_predict": 220},
            },
            timeout=settings.ollama_timeout_seconds,
        )
        response.raise_for_status()
        body = response.json()
        model = str(body.get("model") or settings.ollama_model)
        parsed = json.loads(str(body["response"]))
        normalized, warnings = validate_normalized(parsed, raw_text)
        return normalized, model, warnings
    finally:
        if owned_client:
            http_client.close()


def run_local_ocr(settings: Settings, png_bytes: bytes, client: httpx.Client | None = None) -> LocalOcrOutput:
    warnings: list[str] = []
    try:
        raw_text, confidence, tesseract_version = extract_text(png_bytes, settings.tesseract_languages)
    except Exception as error:
        return LocalOcrOutput(
            raw_text="",
            confidence=0.0,
            normalized={key: None for key in NORMALIZED_SCHEMA["properties"]},
            tesseract_version="unavailable",
            model_version=settings.ollama_model,
            warnings=[f"tesseract_{type(error).__name__}"],
        )
    if not raw_text:
        return LocalOcrOutput(
            raw_text="",
            confidence=0.0,
            normalized={key: None for key in NORMALIZED_SCHEMA["properties"]},
            tesseract_version=tesseract_version,
            model_version=settings.ollama_model,
            warnings=["ocr_text_empty"],
        )
    try:
        normalized, model_version, normalization_warnings = normalize_text(settings, raw_text, client)
        warnings.extend(normalization_warnings)
    except Exception as error:
        normalized = {key: None for key in NORMALIZED_SCHEMA["properties"]}
        model_version = settings.ollama_model
        warnings.append(f"ollama_{type(error).__name__}")
    if warnings:
        confidence = min(confidence, 59.0)
    return LocalOcrOutput(
        raw_text=raw_text,
        confidence=confidence,
        normalized=normalized,
        tesseract_version=tesseract_version,
        model_version=model_version,
        warnings=warnings,
    )


def prewarm_model(settings: Settings, client: httpx.Client | None = None) -> str:
    owned_client = client is None
    http_client = client or httpx.Client(timeout=settings.ollama_timeout_seconds)
    try:
        response = http_client.post(
            f"{settings.ollama_url.rstrip('/')}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": "Reply with exactly READY.",
                "stream": False,
                "keep_alive": "30m",
                "options": {"temperature": 0, "num_predict": 4},
            },
            timeout=settings.ollama_timeout_seconds,
        )
        response.raise_for_status()
        return str(response.json().get("model") or settings.ollama_model)
    finally:
        if owned_client:
            http_client.close()
