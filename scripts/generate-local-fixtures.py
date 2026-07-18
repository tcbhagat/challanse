#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


VARIATIONS = [
    ("01-english-clear", ["SYNTHETIC CEMENT CO", "CHALLAN CH-1001", "OPC Cement 25 BAG"]),
    ("02-hindi-english", ["SYNTHETIC STEEL WORKS", "CHALLAN CH-1002", "TMT Steel 250 KG", "परीक्षण प्रति"]),
    ("03-quantity-decimal", ["SYNTHETIC SAND SUPPLY", "CHALLAN CH-1003", "Synthetic M Sand 12.50 TON"]),
    ("04-low-contrast", ["SYNTHETIC BRICK YARD", "CHALLAN CH-1004", "Fly Ash Brick 950 NOS"]),
    ("05-rotated", ["SYNTHETIC CEMENT CO", "CHALLAN CH-1005", "OPC Cement 40 BAG"]),
]


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate-local-fixtures.py OUTPUT_DIRECTORY")
    output_dir = Path(sys.argv[1]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=38)
    manifest = []
    for name, lines in VARIATIONS:
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
        manifest.append({"file": path.name, "synthetic": True, "expectedText": lines})
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output_dir / "synthetic-tally.csv").write_text(
        "po_number,material_code,material_description,unit,po_quantity\n"
        "PO-SYN-001,CEMENT-OPC,OPC Cement,BAG,100\n"
        "PO-SYN-002,STEEL-TMT,TMT Steel,KG,500\n"
        "PO-SYN-003,SAND-M,Synthetic M Sand,TON,20\n"
        "PO-SYN-004,BRICK-FLYASH,Fly Ash Brick,NOS,2000\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
