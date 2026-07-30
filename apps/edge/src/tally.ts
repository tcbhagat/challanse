// ─── Tally CSV Parser ────────────────────────────────────────────────────────
// TypeScript port of Python services/enrichment/app/reconciliation.py
// Parses Tally-generated CSV purchase order exports into structured rows.

// Expected CSV columns (Tally export format):
//   PoNumber, MaterialCode, MaterialDescription, Quantity, Unit, Rate, Amount

export interface PurchaseOrderRow {
  poNumber: string;
  materialCode: string;
  materialDescription: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface ParseResult {
  rows: PurchaseOrderRow[];
  errors: string[];
  totalRows: number;
}

/**
 * Normalize unit string to a standard format.
 * e.g., "NOS", "Nos.", "nos" → "NOS"
 *        "KG", "Kg.", "kgs" → "KG"
 */
export function normalizeUnit(value: string): string {
  const cleaned = value.trim().toUpperCase().replace(/\.$/, '').replace(/S$/, '');
  const unitMap: Record<string, string> = {
    'NOS': 'NOS',
    'NO': 'NOS',
    'NUM': 'NOS',
    'KG': 'KG',
    'KGS': 'KG',
    'KILO': 'KG',
    'KILOGRAM': 'KG',
    'TON': 'TONNE',
    'TONNE': 'TONNE',
    'TONNES': 'TONNE',
    'LTR': 'LITRE',
    'LITRE': 'LITRE',
    'LITRES': 'LITRE',
    'M': 'METRE',
    'MTR': 'METRE',
    'METRE': 'METRE',
    'METRES': 'METRE',
    'SQFT': 'SQFT',
    'SQ.M': 'SQM',
    'SQM': 'SQM',
    'BAG': 'BAG',
    'BAGS': 'BAG',
    'PCS': 'PCS',
    'PC': 'PCS',
    'PIECE': 'PCS',
    'PIECES': 'PCS',
  };
  return unitMap[cleaned] || cleaned;
}

/**
 * Parse a Tally CSV string into structured purchase order rows.
 * Handles BOM, different line endings, quoted fields, and header variations.
 */
export function parseTallyCsv(content: string): ParseResult {
  const errors: string[] = [];
  const rows: PurchaseOrderRow[] = [];

  // Remove BOM and normalize line endings
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV must have a header row and at least one data row'], totalRows: 0 };
  }

  // Parse header to find column indices
  const header = parseCsvLine(lines[0]);
  const colMap = buildColumnMap(header);

  if (colMap.poNumber === undefined || colMap.materialCode === undefined || colMap.quantity === undefined) {
    errors.push(`CSV missing required columns (PoNumber, MaterialCode, Quantity). Found: ${header.join(', ')}`);
    return { rows, errors, totalRows: 0 };
  }

  for (let i = 1; i < lines.length; i++) {
    try {
      const fields = parseCsvLine(lines[i]);
      if (fields.length < Math.max(colMap.poNumber, colMap.materialCode, colMap.quantity) + 1) {
        errors.push(`Row ${i + 1}: insufficient fields (${fields.length})`);
        continue;
      }

      const poNumber = fields[colMap.poNumber].trim();
      const materialCode = fields[colMap.materialCode].trim();
      const quantity = parseFloat(fields[colMap.quantity].replace(/[,"]/g, ''));

      if (!poNumber || !materialCode) {
        errors.push(`Row ${i + 1}: empty PoNumber or MaterialCode`);
        continue;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        errors.push(`Row ${i + 1}: invalid quantity "${fields[colMap.quantity]}"`);
        continue;
      }

      const materialDescription = colMap.materialDescription !== undefined
        ? fields[colMap.materialDescription].trim()
        : '';
      const unit = colMap.unit !== undefined
        ? normalizeUnit(fields[colMap.unit])
        : 'NOS';
      const rate = colMap.rate !== undefined
        ? parseFloat(fields[colMap.rate].replace(/[,"]/g, '')) || 0
        : 0;
      const amount = colMap.amount !== undefined
        ? parseFloat(fields[colMap.amount].replace(/[,"]/g, '')) || 0
        : 0;

      rows.push({ poNumber, materialCode, materialDescription, quantity, unit, rate, amount });
    } catch (err) {
      errors.push(`Row ${i + 1}: parse error - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { rows, errors, totalRows: rows.length };
}

/**
 * Parse a single CSV line respecting quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Build a column name→index map from CSV header fields.
 * Supports common Tally export variations.
 */
function buildColumnMap(header: string[]): Record<string, number | undefined> {
  const map: Record<string, number | undefined> = {};
  const nameVariants: Record<string, string[]> = {
    poNumber: ['ponumber', 'po_number', 'po no', 'po no.', 'purchase order', 'orderno'],
    materialCode: ['materialcode', 'material_code', 'itemcode', 'item_code', 'code', 'productcode'],
    materialDescription: ['materialdescription', 'material_description', 'description', 'itemdescription', 'item name', 'productname'],
    quantity: ['quantity', 'qty', 'orderqty', 'ordered quantity', 'po quantity'],
    unit: ['unit', 'uom', 'unitofmeasure', 'measurement'],
    rate: ['rate', 'unitrate', 'price', 'unit price'],
    amount: ['amount', 'total', 'value', 'totalamount'],
  };

  for (let i = 0; i < header.length; i++) {
    const clean = header[i].trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '');
    for (const [key, variants] of Object.entries(nameVariants)) {
      if (variants.includes(clean) && map[key] === undefined) {
        map[key] = i;
      }
    }
  }

  return map;
}

/**
 * Calculate delta between site receipt quantities and purchase order quantities.
 * Returns a list of reconciliation rows.
 */
export function calculateReconciliationDeltas(
  purchaseOrders: PurchaseOrderRow[],
  siteReceipts: { poNumber: string; materialCode: string; verifiedQuantity: number; unit: string }[],
): ReconciliationRow[] {
  // Group PO quantities by (poNumber, materialCode, unit)
  const poByKey = new Map<string, number>();
  for (const po of purchaseOrders) {
    const key = `${po.poNumber}::${po.materialCode}::${normalizeUnit(po.unit)}`;
    poByKey.set(key, (poByKey.get(key) || 0) + po.quantity);
  }

  // Group receipt quantities by (poNumber, materialCode, unit)
  const receiptByKey = new Map<string, number>();
  for (const r of siteReceipts) {
    const key = `${r.poNumber}::${r.materialCode}::${normalizeUnit(r.unit)}`;
    receiptByKey.set(key, (receiptByKey.get(key) || 0) + r.verifiedQuantity);
  }

  // Calculate deltas
  const results: ReconciliationRow[] = [];
  const allKeys = new Set([...poByKey.keys(), ...receiptByKey.keys()]);

  for (const key of allKeys) {
    const [poNumber, materialCode, unit] = key.split('::');
    const poQty = poByKey.get(key) || 0;
    const receiptQty = receiptByKey.get(key) || 0;
    results.push({
      poNumber,
      materialCode,
      unit,
      poQuantity: poQty,
      siteReceived: receiptQty,
      isOver: receiptQty > poQty,
    });
  }

  return results.sort((a, b) => a.poNumber.localeCompare(b.poNumber));
}

export interface ReconciliationRow {
  poNumber: string;
  materialCode: string;
  unit: string;
  poQuantity: number;
  siteReceived: number;
  isOver: boolean;
}
