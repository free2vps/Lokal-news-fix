// Generated from hub-preview-libsql-init.sql; the caller supplies the transaction.
// Never run this SQL on existing or production databases.
export const PREVIEW_INITIAL_SQL = String.raw`
-- INISIALISASI CONTENT HUB PREVIEW (Turso Cloud, mesin libSQL)
-- Hanya jalankan setelah memastikan database BARU, KOSONG dan KHUSUS PREVIEW.
-- Jangan jalankan pada database Hub lama, database Production, atau Supabase.
-- Tidak mengimpor berita, akun, kunci, maupun data SQLite lama.
-- Berisi skema awal dan 11 sumber pemerintah NTB nonaktif/belum terverifikasi.
-- Tidak mengaktifkan koleksi, penjadwal, AI, push, ataupun publikasi.
-- Diuji pada SQLite lokal; belum diuji terhadap akun Turso Anda.

-- Transaksi dikelola oleh bootstrapEmptyDatabase().

-- Initial, isolated Content Hub schema. Run deliberately; never at request startup.
-- This does not migrate or touch the existing Supabase or SQLite Hub.
CREATE TABLE IF NOT EXISTS hub_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  jurisdiction TEXT NOT NULL,
  region TEXT NOT NULL,
  requested_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL UNIQUE,
  publisher_domain TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('government_website','rss')),
  discovered_type TEXT NOT NULL DEFAULT 'unverified' CHECK(discovered_type IN ('unverified','html_listing','rss')),
  feed_url TEXT,
  rights_status TEXT NOT NULL DEFAULT 'unknown' CHECK(rights_status IN ('unknown','metadata_only','permission_confirmed')),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hub_sources_domain ON hub_sources(publisher_domain);

CREATE TABLE IF NOT EXISTS hub_admin_credentials (
  id TEXT PRIMARY KEY CHECK(id = 'owner'),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hub_admin_sessions_expiry ON hub_admin_sessions(expires_at_ms);
CREATE TABLE IF NOT EXISTS hub_rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK(count >= 0)
);

CREATE TABLE IF NOT EXISTS hub_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES hub_sources(id),
  identity_key TEXT NOT NULL,
  original_url TEXT NOT NULL,
  normalized_original_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_snippet TEXT,
  source_published_at TEXT,
  source_date_raw TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  editorial_title TEXT,
  editorial_summary TEXT,
  editorial_category TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  review_state TEXT NOT NULL DEFAULT 'pending_review' CHECK(review_state IN ('draft','pending_review','approved','rejected','identity_review')),
  approved_version INTEGER,
  UNIQUE(source_id, identity_key)
);
CREATE INDEX IF NOT EXISTS hub_items_source_url ON hub_items(source_id, normalized_original_url);
CREATE INDEX IF NOT EXISTS hub_items_url ON hub_items(normalized_original_url);
CREATE INDEX IF NOT EXISTS hub_items_review ON hub_items(review_state, last_seen_at);

-- Source observations are append-only evidence, not editorial changes.
CREATE TABLE IF NOT EXISTS hub_item_observations (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES hub_items(id),
  fingerprint TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_snippet TEXT,
  original_url TEXT NOT NULL,
  source_published_at TEXT,
  source_date_raw TEXT,
  conflict INTEGER NOT NULL DEFAULT 0 CHECK(conflict IN (0,1)),
  UNIQUE(item_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS hub_item_approvals (
  item_id TEXT NOT NULL REFERENCES hub_items(id),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  PRIMARY KEY(item_id, version)
);
-- No worker is enabled. This models an idempotent intent, not a publication.
CREATE TABLE IF NOT EXISTS hub_publish_outbox (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL,
  approved_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','superseded','sending','published','duplicate','failed','needs_reconciliation')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(item_id, approved_version) REFERENCES hub_item_approvals(item_id, version)
);

-- No collector endpoint is enabled; this is the future durable replay ledger.
CREATE TABLE IF NOT EXISTS hub_consumed_nonces (
  nonce_hash TEXT PRIMARY KEY,
  consumed_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

-- Only encrypted provider credentials are stored; no provider calls are made yet.
CREATE TABLE IF NOT EXISTS hub_ai_provider_settings (
  provider TEXT PRIMARY KEY CHECK(provider IN ('openrouter','groq','cohere')),
  model TEXT NOT NULL,
  key_ciphertext TEXT,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO hub_schema_migrations(version, applied_at)
VALUES ('001_initial', strftime('%Y-%m-%dT%H:%M:%fZ','now'));


-- Masukkan sumber tanpa menimpa URL, ID atau domain yang sudah ada.

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-provinsi', 'Pemerintah Provinsi Nusa Tenggara Barat', 'Provinsi NTB', 'NTB',
       'https://ntbprov.go.id/', 'https://ntbprov.go.id/', 'ntbprov.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-provinsi' OR normalized_url='https://ntbprov.go.id/' OR publisher_domain='ntbprov.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-lombok-barat', 'Pemerintah Kabupaten Lombok Barat', 'Kabupaten Lombok Barat', 'NTB',
       'https://portal.lombokbaratkab.go.id/jelajah/artikel/', 'https://portal.lombokbaratkab.go.id/jelajah/artikel/', 'lombokbaratkab.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-lombok-barat' OR normalized_url='https://portal.lombokbaratkab.go.id/jelajah/artikel/' OR publisher_domain='lombokbaratkab.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-lombok-tengah', 'Pemerintah Kabupaten Lombok Tengah', 'Kabupaten Lombok Tengah', 'NTB',
       'https://www.lomboktengahkab.go.id/', 'https://www.lomboktengahkab.go.id/', 'lomboktengahkab.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-lombok-tengah' OR normalized_url='https://www.lomboktengahkab.go.id/' OR publisher_domain='lomboktengahkab.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-lombok-timur', 'Pemerintah Kabupaten Lombok Timur', 'Kabupaten Lombok Timur', 'NTB',
       'https://portal.lomboktimurkab.go.id/semua-berita.html', 'https://portal.lomboktimurkab.go.id/semua-berita.html', 'lomboktimurkab.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-lombok-timur' OR normalized_url='https://portal.lomboktimurkab.go.id/semua-berita.html' OR publisher_domain='lomboktimurkab.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-lombok-utara', 'Pemerintah Kabupaten Lombok Utara', 'Kabupaten Lombok Utara', 'NTB',
       'https://lombokutarakab.go.id/', 'https://lombokutarakab.go.id/', 'lombokutarakab.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-lombok-utara' OR normalized_url='https://lombokutarakab.go.id/' OR publisher_domain='lombokutarakab.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-sumbawa', 'Sekretariat Daerah Kabupaten Sumbawa', 'Kabupaten Sumbawa', 'NTB',
       'https://setda.sumbawakab.go.id/berita/', 'https://setda.sumbawakab.go.id/berita/', 'sumbawakab.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-sumbawa' OR normalized_url='https://setda.sumbawakab.go.id/berita/' OR publisher_domain='sumbawakab.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-sumbawa-barat', 'Prokopim Kabupaten Sumbawa Barat', 'Kabupaten Sumbawa Barat', 'NTB',
       'https://prokopim.sumbawabaratkab.go.id/category/berita/', 'https://prokopim.sumbawabaratkab.go.id/category/berita/', 'sumbawabaratkab.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-sumbawa-barat' OR normalized_url='https://prokopim.sumbawabaratkab.go.id/category/berita/' OR publisher_domain='sumbawabaratkab.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-dompu', 'Diskominfo Kabupaten Dompu', 'Kabupaten Dompu', 'NTB',
       'https://diskominfo.dompukab.go.id/berita', 'https://diskominfo.dompukab.go.id/berita', 'dompukab.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-dompu' OR normalized_url='https://diskominfo.dompukab.go.id/berita' OR publisher_domain='dompukab.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-kabupaten-bima', 'Diskominfostik Kabupaten Bima', 'Kabupaten Bima', 'NTB',
       'https://diskominfostik.bimakab.go.id/id/news?sort=latest', 'https://diskominfostik.bimakab.go.id/id/news?sort=latest', 'bimakab.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-kabupaten-bima' OR normalized_url='https://diskominfostik.bimakab.go.id/id/news?sort=latest' OR publisher_domain='bimakab.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-kota-mataram', 'Pemerintah Kota Mataram', 'Kota Mataram', 'NTB',
       'https://web.mataramkota.go.id/news/', 'https://web.mataramkota.go.id/news/', 'mataramkota.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-kota-mataram' OR normalized_url='https://web.mataramkota.go.id/news/' OR publisher_domain='mataramkota.go.id');

INSERT INTO hub_sources
  (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain,
   source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
SELECT 'gov-ntb-kota-bima', 'Diskominfotik Kota Bima', 'Kota Bima', 'NTB',
       'https://kominfotik.bimakota.go.id/', 'https://kominfotik.bimakota.go.id/', 'bimakota.go.id',
       'government_website', 'unverified', 'unknown', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM hub_sources
  WHERE id='gov-ntb-kota-bima' OR normalized_url='https://kominfotik.bimakota.go.id/' OR publisher_domain='bimakota.go.id');
`;
