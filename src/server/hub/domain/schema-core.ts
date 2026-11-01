import type {Client} from '@libsql/client';

/**
 * Penjaga bentuk database Hub (Turso).
 *
 * Masalah yang diselesaikan: skema Hub tumbuh saat aplikasi berjalan — hanya 11 tabel ada di berkas
 * migrasi, sedangkan puluhan tabel lain dibuat oleh modulnya masing-masing dengan
 * `CREATE TABLE IF NOT EXISTS`, dan kolom baru ditambahkan lewat `ALTER TABLE` yang berserakan.
 * `CREATE TABLE IF NOT EXISTS` TIDAK PERNAH menambah kolom ke tabel yang sudah ada, sehingga
 * database lama bisa "hidup" dengan bentuk lama: kode membaca kolom yang tidak ada, galatnya
 * tertelan `try/catch`, dan fitur mati tanpa jejak.
 *
 * Fungsi di berkas ini membuat semua itu bisa diperiksa dan diperbaiki SENDIRI oleh Hub:
 *   • `prepareCore`  — memastikan tabel inti + kolom yang wajib ada benar-benar ada.
 *   • `schemaReport` — melaporkan bentuk database yang sebenarnya (tanpa perlu SQL manual).
 */

/** Tabel inti jalur tarik → pilih → terbit. Tanpa ini, seluruh alur tidak bisa berjalan. */
const CORE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS hub_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    region TEXT NOT NULL,
    requested_url TEXT NOT NULL,
    normalized_url TEXT NOT NULL UNIQUE,
    publisher_domain TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    rights_status TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    discovered_type TEXT NOT NULL,
    feed_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hub_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES hub_sources(id),
    identity_key TEXT NOT NULL,
    original_url TEXT NOT NULL,
    normalized_original_url TEXT NOT NULL,
    source_title TEXT NOT NULL,
    source_snippet TEXT,
    source_published_at TEXT,
    source_date_raw TEXT,
    source_image_url TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    editorial_title TEXT,
    editorial_summary TEXT,
    editorial_category TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    review_state TEXT NOT NULL DEFAULT 'pending_review',
    approved_version INTEGER,
    UNIQUE(source_id, identity_key)
  )`,
  `CREATE TABLE IF NOT EXISTS hub_item_observations (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES hub_items(id),
    fingerprint TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source_title TEXT NOT NULL,
    source_snippet TEXT,
    original_url TEXT NOT NULL,
    source_published_at TEXT,
    source_date_raw TEXT,
    conflict INTEGER NOT NULL DEFAULT 0,
    UNIQUE(item_id, fingerprint)
  )`,
  `CREATE TABLE IF NOT EXISTS hub_item_approvals (
    item_id TEXT NOT NULL REFERENCES hub_items(id),
    version INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    PRIMARY KEY(item_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS hub_publish_outbox (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    item_id TEXT NOT NULL,
    approved_version INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS hub_items_source_url ON hub_items(source_id, normalized_original_url)',
  'CREATE INDEX IF NOT EXISTS hub_items_url ON hub_items(normalized_original_url)',
  'CREATE INDEX IF NOT EXISTS hub_items_review ON hub_items(review_state, last_seen_at)',
];

/** Kolom yang WAJIB ada pada tabel inti. Ditambal otomatis bila database lama belum memilikinya. */
const CORE_COLUMNS: Record<string, Record<string, string>> = {
  hub_sources: {
    rights_status: 'TEXT NOT NULL DEFAULT "unknown"',
    is_active: 'INTEGER NOT NULL DEFAULT 0',
    discovered_type: 'TEXT NOT NULL DEFAULT "unverified"',
    feed_url: 'TEXT',
  },
  hub_items: {
    source_image_url: 'TEXT',
    editorial_title: 'TEXT',
    editorial_summary: 'TEXT',
    editorial_category: 'TEXT',
    approved_version: 'INTEGER',
  },
  hub_item_observations: {conflict: 'INTEGER NOT NULL DEFAULT 0'},
  hub_publish_outbox: {status: 'TEXT NOT NULL DEFAULT "queued"', created_at: 'TEXT NOT NULL DEFAULT ""'},
};

/**
 * Kolom tambahan pada tabel fitur (v2/v3). Modulnya sendiri sudah membuat tabel; di sini hanya
 * dipastikan kolom baru ikut masuk ke database yang tabelnya dibuat versi lama.
 */
const FEATURE_COLUMNS: Record<string, Record<string, string>> = {
  hub_auto_editor_config_v2: {mix_regional_pct: 'INTEGER NOT NULL DEFAULT 60'},
  hub_autopublish_v2: {max_per_run: 'INTEGER NOT NULL DEFAULT 4', schedule_enabled: 'INTEGER NOT NULL DEFAULT 0'},
  hub_datasets_v3: {},
  hub_ai_summaries_v2: {},
};

async function columnsOf(db: Client, table: string): Promise<string[]> {
  try {
    const rows = (await db.execute(`PRAGMA table_info(${table})`)).rows;
    return rows.map(r => String(r.name));
  } catch {
    return [];
  }
}

/** Tambahkan kolom yang belum ada. Tidak pernah melempar: satu kolom gagal tidak menghentikan sisanya. */
export async function ensureColumns(db: Client, table: string, wanted: Record<string, string>): Promise<string[]> {
  const have = new Set(await columnsOf(db, table));
  if (!have.size) return []; // tabel belum ada → urusan modulnya sendiri
  const added: string[] = [];
  for (const [column, decl] of Object.entries(wanted)) {
    if (have.has(column)) continue;
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      added.push(`${table}.${column}`);
    } catch { /* sudah ada / bentuk tak cocok: lewati */ }
  }
  return added;
}

/** Dipanggil di awal alur utama. Idempoten: aman dijalankan setiap putaran. */
export async function prepareCore(db: Client): Promise<{tables: number; added: string[]}> {
  let tables = 0;
  for (const sql of CORE_DDL) {
    try { await db.execute(sql); tables += 1; } catch { /* biarkan alur melaporkan sendiri */ }
  }
  const added: string[] = [];
  for (const [table, wanted] of Object.entries(CORE_COLUMNS)) added.push(...await ensureColumns(db, table, wanted));
  for (const [table, wanted] of Object.entries(FEATURE_COLUMNS)) {
    if (!Object.keys(wanted).length) continue;
    added.push(...await ensureColumns(db, table, wanted));
  }
  return {tables, added};
}

export type SchemaReport = {
  tables: number; columns: number; missing: string[]; checkedAt: string;
};

/**
 * Bentuk database yang SEBENARNYA — inilah pengganti "jalankan SQL di Turso".
 * Cukup dipanggil dari status Hub, hasilnya tampil di panel tanpa alat tambahan.
 */
export async function schemaReport(db: Client): Promise<SchemaReport> {
  const names: string[] = [];
  try {
    const rows = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'hub%' ORDER BY name")).rows;
    for (const row of rows) names.push(String(row.name));
  } catch { /* database tidak terjangkau */ }
  let columns = 0;
  const missing: string[] = [];
  for (const table of names) {
    const cols = await columnsOf(db, table);
    columns += cols.length;
    const wanted = {...(CORE_COLUMNS[table] || {}), ...(FEATURE_COLUMNS[table] || {})};
    const have = new Set(cols);
    for (const column of Object.keys(wanted)) if (!have.has(column)) missing.push(`${table}.${column}`);
  }
  return {tables: names.length, columns, missing, checkedAt: new Date().toISOString()};
}
