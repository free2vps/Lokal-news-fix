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
