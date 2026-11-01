import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareCore, schemaReport, ensureColumns} from '../src/server/hub/domain/schema-core';

function tmp() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'schema-'));
  const db = createClient({url: 'file:' + path.join(dir, 's.db')});
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return db;
}

test('database KOSONG: tabel inti jalur terbit dibuat lengkap', async () => {
  const db = tmp();
  try {
    const out = await prepareCore(db);
    assert.ok(out.tables >= 5);
    const report = await schemaReport(db);
    for (const t of ['hub_items', 'hub_sources', 'hub_item_observations', 'hub_item_approvals', 'hub_publish_outbox']) {
      assert.ok(report.tables >= 5);
    }
    assert.deepEqual(report.missing, [], 'tidak ada kolom wajib yang hilang');
    // Kolom gambar harus benar-benar bisa ditulis (dulu INSERT gagal bila kolom tak ada).
    await db.execute({sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,is_active,discovered_type,feed_url,created_at,updated_at) VALUES('s','m','Provinsi','NTB','https://a.test','https://a.test','a.test','rss','permission_confirmed',1,'rss','https://a.test/rss','x','x')", args: []});
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_image_url,first_seen_at,last_seen_at) VALUES('i','s','k','https://a.test/1','https://a.test/1','J','https://cdn.a.test/1.jpg','x','x')", args: []});
    const row = (await db.execute("SELECT source_image_url FROM hub_items WHERE id='i'")).rows[0];
    assert.equal(String(row.source_image_url), 'https://cdn.a.test/1.jpg');
  } finally { await db.close(); }
});

test('database BENTUK LAMA: kolom yang belum ada ditambahkan tanpa menghapus data', async () => {
  const db = tmp();
  try {
    // Meniru database yang dibuat versi lama: tanpa source_image_url, tanpa approved_version.
    await db.execute(`CREATE TABLE hub_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, jurisdiction TEXT NOT NULL, region TEXT NOT NULL,
      requested_url TEXT NOT NULL, normalized_url TEXT NOT NULL UNIQUE, publisher_domain TEXT NOT NULL, source_kind TEXT NOT NULL,
      rights_status TEXT NOT NULL DEFAULT 'unknown', is_active INTEGER NOT NULL DEFAULT 0, discovered_type TEXT NOT NULL DEFAULT 'rss',
      feed_url TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`);
    await db.execute(`CREATE TABLE hub_items (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, identity_key TEXT NOT NULL, original_url TEXT NOT NULL,
      normalized_original_url TEXT NOT NULL, source_title TEXT NOT NULL, source_snippet TEXT, source_published_at TEXT, source_date_raw TEXT,
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, editorial_title TEXT, editorial_summary TEXT, editorial_category TEXT,
      version INTEGER NOT NULL DEFAULT 1, review_state TEXT NOT NULL DEFAULT 'pending_review', UNIQUE(source_id, identity_key))`);
    await db.execute("INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind) VALUES('s','m','P','NTB','https://a.test','https://a.test','a.test','rss')");
    await db.execute("INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,first_seen_at,last_seen_at) VALUES('i','s','k','https://a.test/1','https://a.test/1','Judul lama','x','x')");

    const before = await schemaReport(db);
    assert.ok(before.missing.includes('hub_items.source_image_url'), 'harus terdeteksi hilang sebelum diperbaiki');

    const out = await prepareCore(db);
    assert.ok(out.added.includes('hub_items.source_image_url'));
    assert.ok(out.added.includes('hub_items.approved_version'));

    const after = await schemaReport(db);
    assert.deepEqual(after.missing, []);
    const keep = (await db.execute("SELECT source_title FROM hub_items WHERE id='i'")).rows[0];
    assert.equal(String(keep.source_title), 'Judul lama', 'data lama tidak boleh hilang');
  } finally { await db.close(); }
});

test('ensureColumns tidak melempar untuk tabel yang tidak ada', async () => {
  const db = tmp();
  try {
    assert.deepEqual(await ensureColumns(db, 'hub_tidak_ada', {x: 'TEXT'}), []);
  } finally { await db.close(); }
});
