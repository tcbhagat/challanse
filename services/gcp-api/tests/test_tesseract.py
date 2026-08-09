from types import SimpleNamespace

from app import tesseract


def test_tesseract_uses_fixed_executable_arguments_and_limits_output(monkeypatch):
    observed = {}

    def run(arguments, **options):
        observed["arguments"] = arguments
        observed["options"] = options
        return SimpleNamespace(returncode=0, stdout="VENDOR\nInvoice CH-1\n25 BAG\n" + "x" * 120_000)

    monkeypatch.setattr(tesseract.subprocess, "run", run)
    fields, diagnostic = tesseract.extract_fields(b"synthetic-image")

    assert observed["arguments"][0] == "/usr/bin/tesseract"
    assert observed["arguments"][2:] == ["stdout", "-l", "eng+hin", "--psm", "6"]
    assert observed["options"]["timeout"] == 45
    assert "shell" not in observed["options"]
    assert fields.invoiceNumber == "CH-1"
    assert fields.quantity == 25
    assert '"textLength": 100000' in diagnostic
