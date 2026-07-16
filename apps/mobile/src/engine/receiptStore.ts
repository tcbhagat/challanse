import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';
import { getOrCreateDatabaseKey } from './secureKey';
import { recordTelemetryEvent } from '../telemetry/telemetryStore';
import { withReceiptSpan } from '../telemetry/receiptTelemetry';

export type ReceiptCaptureInput = {
  imageBlob: Uint8Array | ArrayBuffer;
  capturedAtUnix?: number;
  vendorId: string;
  receiptId?: string;
  siteId: string;
  deviceId: string;
  capturedQuantity: number;
  appVersion: string;
  configurationVersion: number;
};

export type ReceiptEventRecord = {
  receiptId: string;
  capturedAtUnix: number;
  imageBytes: number;
  vendorId: string;
};

type ReceiptDatabase = {
  executeAsync: (query: string, params?: unknown[]) => Promise<unknown>;
  close: () => void;
  getDbPath: () => string;
};

const LEGACY_DATABASE_NAME = 'receipt-ingestion.db';
const DATABASE_NAME = 'receipt-ingestion-v2.db';

let databasePromise: Promise<ReceiptDatabase> | null = null;

function adaptDatabase(database: DB): ReceiptDatabase {
  return {
    executeAsync: (query, params = []) => database.execute(query, params as Scalar[]),
    close: () => database.close(),
    getDbPath: () => database.getDbPath(),
  };
}

async function verifyCipher(database: DB): Promise<void> {
  const version = await database.execute('PRAGMA cipher_version');
  const cipherVersion = Object.values(version.rows[0] ?? {})[0];
  if (typeof cipherVersion !== 'string' || cipherVersion.length === 0) {
    throw new Error('SQLCipher is not active for the receipt database.');
  }
  await database.execute('SELECT COUNT(*) AS table_count FROM sqlite_master');
}

async function migrateLegacyDatabase(encrypted: DB): Promise<void> {
  const marker = await encrypted.execute(
    "SELECT value FROM database_meta WHERE key = 'legacy_migration_complete' LIMIT 1",
  );
  if (marker.rows.length > 0) return;

  const legacy = open({ name: LEGACY_DATABASE_NAME });
  try {
    const tables = await legacy.execute(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
    );
    if (tables.rows.length > 0) {
      await encrypted.transaction(async (transaction) => {
        for (const table of tables.rows) {
          const tableName = String(table.name);
          const createSql = String(table.sql);
          await transaction.execute(createSql);
          const source = await legacy.execute(`SELECT * FROM "${tableName.replaceAll('"', '""')}"`);
          if (source.rows.length === 0) continue;
          const columns = Object.keys(source.rows[0] ?? {});
          const quotedColumns = columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(',');
          const placeholders = columns.map(() => '?').join(',');
          for (const row of source.rows) {
            await transaction.execute(
              `INSERT INTO "${tableName.replaceAll('"', '""')}" (${quotedColumns}) VALUES (${placeholders})`,
              columns.map((column) => row[column]) as Scalar[],
            );
          }
        }
        const indexes = await legacy.execute(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
        );
        for (const index of indexes.rows) await transaction.execute(String(index.sql));
      });
    }
    await encrypted.execute(
      "INSERT OR REPLACE INTO database_meta (key, value) VALUES ('legacy_migration_complete', ?)",
      [String(Date.now())],
    );
    legacy.delete();
  } finally {
    try { legacy.close(); } catch { /* already deleted */ }
  }
}

function toUint8Array(blob: Uint8Array | ArrayBuffer): Uint8Array {
  return blob instanceof Uint8Array ? blob : new Uint8Array(blob);
}

function generateReceiptId(): string {
  const bytes = new Uint8Array(16);
  (globalThis as unknown as { crypto: { getRandomValues: (values: Uint8Array) => Uint8Array } }).crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function ensureReceiptColumns(database: ReceiptDatabase): Promise<void> {
  const result = (await database.executeAsync('PRAGMA table_info(receipt_events)')) as {
    rows?: Array<{ name?: string }>;
  };
  const columns = new Set((result.rows ?? []).map((row) => row.name));
  const additions = [
    ['receipt_uuid', "TEXT NOT NULL DEFAULT ''"],
    ['site_id', "TEXT NOT NULL DEFAULT ''"],
    ['device_id', "TEXT NOT NULL DEFAULT ''"],
    ['captured_quantity', 'INTEGER NOT NULL DEFAULT 1'],
    ['app_version', "TEXT NOT NULL DEFAULT ''"],
    ['configuration_version', 'INTEGER NOT NULL DEFAULT 0'],
  ] as const;
  for (const [name, definition] of additions) {
    if (!columns.has(name)) await database.executeAsync(`ALTER TABLE receipt_events ADD COLUMN ${name} ${definition}`);
  }
  await database.executeAsync(
    `UPDATE receipt_events SET receipt_uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) WHERE receipt_uuid = ''`,
  );
  await database.executeAsync('CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_events_uuid ON receipt_events(receipt_uuid)');
}

async function initializeDatabase(): Promise<ReceiptDatabase> {
  const key = await getOrCreateDatabaseKey();
  const nativeDatabase = open({ name: DATABASE_NAME, encryptionKey: key });
  await verifyCipher(nativeDatabase);
  const database = adaptDatabase(nativeDatabase);
  await database.executeAsync(
    'CREATE TABLE IF NOT EXISTS database_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  await migrateLegacyDatabase(nativeDatabase);
  await database.executeAsync('PRAGMA journal_mode = WAL');
  await database.executeAsync('PRAGMA synchronous = NORMAL');
  await database.executeAsync('PRAGMA temp_store = MEMORY');
  await database.executeAsync(
    'CREATE TABLE IF NOT EXISTS receipt_events (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
      'receipt_uuid TEXT NOT NULL UNIQUE,' +
      'site_id TEXT NOT NULL,' +
      'device_id TEXT NOT NULL,' +
      'vendor_id TEXT NOT NULL,' +
      'captured_at_unix INTEGER NOT NULL,' +
      'captured_quantity INTEGER NOT NULL,' +
      'app_version TEXT NOT NULL,' +
      'configuration_version INTEGER NOT NULL,' +
      'image_blob BLOB NOT NULL' +
      ')',
  );
  await ensureReceiptColumns(database);
  await database.executeAsync(
    'CREATE INDEX IF NOT EXISTS idx_receipt_events_vendor_time ' +
      'ON receipt_events(vendor_id, captured_at_unix DESC)',
  );

  return database;
}

export async function getReceiptDatabaseSecurityStatus(): Promise<{
  encrypted: boolean;
  databasePath: string;
}> {
  const database = await getReceiptDatabase();
  const result = await database.executeAsync('PRAGMA cipher_version') as { rows?: Array<Record<string, unknown>> };
  const version = Object.values(result.rows?.[0] ?? {})[0];
  return { encrypted: typeof version === 'string' && version.length > 0, databasePath: database.getDbPath() };
}

export async function getReceiptDatabase(): Promise<ReceiptDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

export async function insertReceiptEvent(
  input: ReceiptCaptureInput,
): Promise<ReceiptEventRecord> {
  return withReceiptSpan(
    'receipt.frontend_write',
    { vendor_id: input.vendorId },
    async () => {
      const database = await getReceiptDatabase();
      const imageBlob = toUint8Array(input.imageBlob);
      const capturedAtUnix = input.capturedAtUnix ?? Math.floor(Date.now() / 1000);
      const receiptId = input.receiptId ?? generateReceiptId();
      const clock = (globalThis as unknown as { performance?: { now?: () => number } }).performance;
      const startedAt = clock?.now?.() ?? Date.now();

      await database.executeAsync(
        'INSERT INTO receipt_events (receipt_uuid, site_id, device_id, vendor_id, captured_at_unix, captured_quantity, app_version, configuration_version, image_blob) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [receiptId, input.siteId, input.deviceId, input.vendorId, capturedAtUnix, input.capturedQuantity, input.appVersion, input.configurationVersion, imageBlob],
      );

      const endedAt = clock?.now?.() ?? Date.now();
      void recordTelemetryEvent({
        eventName: 'frontend_write_duration_ms',
        vendorId: input.vendorId,
        durationMs: Math.max(0, endedAt - startedAt),
        value: imageBlob.byteLength,
        attributes: {
          imageBytes: imageBlob.byteLength,
          capturedAtUnix,
        },
      });

      return {
        receiptId,
        vendorId: input.vendorId,
        capturedAtUnix,
        imageBytes: imageBlob.byteLength,
      };
    },
  );
}

export async function getReceiptContext(): Promise<{
  eventCount: number;
  lastCapturedAtUnix: number | null;
  lastVendorId: string;
}> {
  const database = await getReceiptDatabase();
  const recentRows = (await database.executeAsync(
    'SELECT vendor_id, captured_at_unix FROM receipt_events ORDER BY captured_at_unix DESC, id DESC LIMIT 1',
  )) as { rows?: Array<{ vendor_id?: string; captured_at_unix?: number }> };
  const countRows = (await database.executeAsync(
    'SELECT COUNT(*) AS event_count FROM receipt_events',
  )) as { rows?: Array<{ event_count?: number }> };

  const latestRow = recentRows.rows?.[0];
  const countRow = countRows.rows?.[0];

  return {
    eventCount: Number(countRow?.event_count ?? 0),
    lastCapturedAtUnix: latestRow?.captured_at_unix ?? null,
    lastVendorId: latestRow?.vendor_id ?? '',
  };
}
