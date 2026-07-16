import csv
from dataclasses import dataclass
from io import StringIO


@dataclass(frozen=True)
class PurchaseOrderRow:
    po_number: str
    material_code: str
    quantity: float
    unit: str


def parse_tally_csv(content: str) -> list[PurchaseOrderRow]:
    reader = csv.DictReader(StringIO(content))
    required = {"po_number", "material_code", "quantity", "unit"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValueError("invalid_tally_schema")
    rows = [
        PurchaseOrderRow(
            po_number=str(row["po_number"]).strip(),
            material_code=str(row["material_code"]).strip().upper(),
            quantity=float(row["quantity"]),
            unit=str(row["unit"]).strip().upper(),
        )
        for row in reader
    ]
    identities = {(row.po_number, row.material_code, row.unit) for row in rows}
    if len(identities) != len(rows):
        raise ValueError("duplicate_tally_row")
    return rows


def delta_rows(received: dict[tuple[str, str, str], float], purchase_orders: list[PurchaseOrderRow]) -> list[dict[str, object]]:
    return [
        {
            "po_number": row.po_number,
            "material_code": row.material_code,
            "unit": row.unit,
            "po_quantity": row.quantity,
            "site_received": received.get((row.po_number, row.material_code, row.unit), 0.0),
            "is_over": received.get((row.po_number, row.material_code, row.unit), 0.0) > row.quantity,
        }
        for row in purchase_orders
    ]
