import json
import os
import re
# The executable and complete argument template are fixed constants.
import subprocess  # nosec B404
import tempfile
from pathlib import Path
from .schemas import InvoiceFields

TESSERACT = Path("/usr/bin/tesseract")
UNIT_PATTERN = re.compile(r"\b(BAG|KG|TON|NOS|LTR|M3|UNIT)\b", re.I)
QUANTITY_PATTERN = re.compile(r"\b(\d+(?:\.\d+)?)\s*(BAG|KG|TON|NOS|LTR|M3|UNIT)\b", re.I)
NUMBER_PATTERN = re.compile(r"(?:invoice|challan)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\-/]+)", re.I)

def extract_fields(image: bytes) -> tuple[InvoiceFields, str]:
    if not TESSERACT.is_file():
        raise RuntimeError("OCR unavailable")
    descriptor, filename = tempfile.mkstemp(suffix=".webp")
    try:
        os.write(descriptor, image)
        os.close(descriptor)
        # No executable or argument is derived from user input.
        result = subprocess.run([str(TESSERACT), filename, "stdout", "-l", "eng+hin", "--psm", "6"], capture_output=True, text=True, timeout=45, check=False, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})  # nosec B603
        text = result.stdout[:100_000]
        if result.returncode != 0:
            raise RuntimeError("OCR failed")
        quantity = QUANTITY_PATTERN.search(text)
        number = NUMBER_PATTERN.search(text)
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        fields = InvoiceFields(vendor=lines[0][:160] if lines else "", invoiceNumber=number.group(1)[:120] if number else "", material=lines[-1][:240] if len(lines) > 1 else "", quantity=float(quantity.group(1)) if quantity else None, unit=quantity.group(2).upper() if quantity else None)
        return fields, json.dumps({"engine": "tesseract", "languages": ["eng", "hin"], "textLength": len(text)})
    finally:
        try: os.unlink(filename)
        except FileNotFoundError: pass
