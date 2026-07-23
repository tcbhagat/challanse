import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


VARIATIONS = [
    {
        "name": "01-english-clear",
        "lines": ["SYNTHETIC CEMENT CO", "CHALLAN CH-1001", "OPC Cement 25 BAG"],
        "expected": {"challanNumber": "CH-1001", "material": "OPC Cement", "quantity": 25.0, "unit": "BAG"},
        "expectedReviewState": "READY_FOR_REVIEW",
    },
    {
        "name": "02-hindi-english",
        "lines": ["SYNTHETIC STEEL WORKS", "CHALLAN CH-1002", "टीएमटी स्टील 250 KG", "केवल कृत्रिम परीक्षण"],
        "expected": {"challanNumber": "CH-1002", "material": "TMT Steel", "quantity": 250.0, "unit": "KG"},
        "expectedReviewState": "READY_FOR_REVIEW",
    },
    {
        "name": "03-quantity-decimal",
        "lines": ["SYNTHETIC SAND SUPPLY", "CHALLAN CH-1003", "Synthetic M Sand 12.50 TON"],
        "expected": {"challanNumber": "CH-1003", "material": "Synthetic M Sand", "quantity": 12.5, "unit": "TON"},
        "expectedReviewState": "READY_FOR_REVIEW",
    },
    {
        "name": "04-low-contrast",
        "lines": ["SYNTHETIC BRICK YARD", "CHALLAN CH-1004", "Fly Ash Brick 950 NOS"],
        "expected": {"challanNumber": "CH-1004", "material": "Fly Ash Brick", "quantity": 950.0, "unit": "NOS"},
        "expectedReviewState": "NEEDS_HUMAN_REVIEW",
    },
    {
        "name": "05-rotated",
        "lines": ["SYNTHETIC CEMENT CO", "CHALLAN CH-1005", "OPC Cement 40 BAG"],
        "expected": {"challanNumber": "CH-1005", "material": "OPC Cement", "quantity": 40.0, "unit": "BAG"},
        "expectedReviewState": "NEEDS_HUMAN_REVIEW",
    },
]

TALLY_FIXTURES = {
    "synthetic-tally.csv": (
        "po_number,material_code,quantity,unit\n"
        "PO-SYN-001,CEMENT-OPC,100,BAG\n"
        "PO-SYN-002,STEEL-TMT,500,KG\n"
        "PO-SYN-003,SAND-M,20,TON\n"
        "PO-SYN-004,BRICK-FLYASH,2000,NOS\n"
    ),
    "synthetic-tally-duplicate.csv": (
        "po_number,material_code,quantity,unit\n"
        "PO-SYN-001,CEMENT-OPC,100,BAG\n"
        "PO-SYN-002,STEEL-TMT,500,KG\n"
        "PO-SYN-003,SAND-M,20,TON\n"
        "PO-SYN-004,BRICK-FLYASH,2000,NOS\n"
    ),
    "synthetic-tally-malformed.csv": (
        "purchase_order,item,qty\n"
        "PO-SYN-BAD,CEMENT-OPC,100\n"
    ),
    "synthetic-tally-unit-mismatch.csv": (
        "po_number,material_code,quantity,unit\n"
        "PO-SYN-UNIT,CEMENT-OPC,100,KG\n"
    ),
    "synthetic-tally-over-po.csv": (
        "po_number,material_code,quantity,unit\n"
        "PO-SYN-OVER,CEMENT-OPC,10,BAG\n"
    ),
}


def generate_local_fixtures(output_directory: str | Path) -> list[dict[str, object]]:
    output_dir = Path(output_directory).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    devanagari_font = Path("/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf")
    font = ImageFont.truetype(devanagari_font, 38) if devanagari_font.is_file() else ImageFont.load_default(size=38)
    manifest: list[dict[str, object]] = []
    for variation in VARIATIONS:
        name = str(variation["name"])
        lines = list(variation["lines"])
        background = (232, 232, 224) if name == "04-low-contrast" else "white"
        ink = (150, 150, 145) if name == "04-low-contrast" else "black"
        image = Image.new("RGB", (1200, 800), background)
        draw = ImageDraw.Draw(image)
        draw.rectangle((45, 45, 1155, 755), outline=ink, width=4)
        draw.text((90, 90), "SYNTHETIC TEST - NOT A REAL CHALLAN", fill=ink, font=font)
        for index, line in enumerate(lines):
            draw.text((90, 210 + index * 100), line, fill=ink, font=font)
        if name == "05-rotated":
            image = image.rotate(7, expand=False, fillcolor="white")
        path = output_dir / f"{name}.webp"
        image.save(path, "WEBP", quality=80, method=6)
        manifest.append(
            {
                "file": path.name,
                "synthetic": True,
                "expectedText": lines,
                "expected": variation["expected"],
                "expectedReviewState": variation["expectedReviewState"],
                "nullableFields": ["vendor", "challanNumber", "material", "quantity", "unit"],
            }
        )
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    for filename, content in TALLY_FIXTURES.items():
        (output_dir / filename).write_text(content, encoding="utf-8")
    return manifest
