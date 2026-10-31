import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareProfiles, profileBatch, profileStatus} from '../src/server/hub/domain/content-profile';
import {prepareValues, valueBatch, valueStatus} from '../src/server/hub/domain/editorial-value';
import {prepareAutoEditor} from '../src/server/hub/domain/auto-editor';
import {setRssActive} from '../src/server/hub/domain/rss-runtime';

const SRC = 'aaaaaaaa-1111-1111-1111-111111111111';

async function fixture(items: number, rights = 'permission_confirmed') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cursor-'));
  const db = createClient({url: 'file:' + path.join(dir, 'c.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute({
    sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,is_active,discovered_type,feed_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,'rss',?,?,?)",
    args: [SRC, 'media', 'Provinsi', 'NTB', 'https://a.test', 'https://a.test', 'a.test', 'rss', rights, 'https://a.test/rss', '2026-10-30', '2026-10-30'],
  });
  for (let n = 1; n <= items; n++) {
    await db.execute({
      sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,version,review_state) VALUES(?,?,?,?,?,?,?,?,?,?,1,'pending_review')",
      args: [`item-${String(n).padStart(4, '0')}`, SRC, 'k' + n, 'https://a.test/' + n, 'https://a.test/' + n,
        'Judul berita NTB nomor ' + n, 'Ringkasan berita NTB yang cukup panjang untuk diolah menjadi berita portal daerah.', '2026-10-30T09:00:00.000Z', '2026-10-30', '2026-10-30'],
    });
  }
  await prepareProfiles(db); await prepareValues(db); await prepareAutoEditor(db);
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return {db};
}

test('kursor profil maju sehingga item ke-26 dan seterusnya ikut diproses', async () => {
  const {db} = await fixture(60);
  const r1 = await profileBatch(db, '');
  assert.equal(r1.processed, 25);
  assert.ok(r1.nextCursor, 'putaran pertama memberi kursor');
  const r2 = await profileBatch(db, r1.nextCursor!);
  assert.equal(r2.processed, 25);
  const st = await profileStatus(db);
  assert.ok(st.stored >= 50, `profil tersimpan ${st.stored} harus ≥ 50 (dulu mentok 25)`);
  await db.close();
});

test('kursor nilai maju sehingga kelas dihitung untuk lebih dari 25 berita', async () => {
  const {db} = await fixture(60);
  const r1 = await valueBatch(db, '');
  assert.equal(r1.processed, 25);
  assert.ok(r1.nextCursor);
  const r2 = await valueBatch(db, r1.nextCursor!);
  assert.equal(r2.processed, 25);
  const st = await valueStatus(db);
  assert.ok(st.stored >= 50, `nilai tersimpan ${st.stored} harus ≥ 50 (dulu mentok 25)`);
  await db.close();
});

test('mengaktifkan sumber tidak menurunkan hak yang sudah dikonfirmasi manusia', async () => {
  const {db} = await fixture(1, 'permission_confirmed');
  await db.execute({sql: "UPDATE hub_sources SET is_active=0 WHERE id=?", args: [SRC]});
  const out = await setRssActive(db, SRC, true);
  const row = (await db.execute({sql: 'SELECT rights_status FROM hub_sources WHERE id=?', args: [SRC]})).rows[0];
  assert.equal(String(row.rights_status), 'permission_confirmed', 'hak tidak boleh turun ke metadata_only');
  assert.equal(out.active, true);
  await db.close();
});

test('sumber tanpa pernyataan hak tetap diberi metadata_only saat diaktifkan', async () => {
  const {db} = await fixture(1, 'unknown');
  await db.execute({sql: "UPDATE hub_sources SET is_active=0 WHERE id=?", args: [SRC]});
  await setRssActive(db, SRC, true);
  const row = (await db.execute({sql: 'SELECT rights_status FROM hub_sources WHERE id=?', args: [SRC]})).rows[0];
  assert.equal(String(row.rights_status), 'metadata_only');
  await db.close();
});

// —— RSS Manager satu saklar ——
import {toggleSource} from '../src/server/hub/domain/rss-runtime';

test('saklar aktif: memvalidasi feed lalu menaikkan hak ke permission_confirmed', async () => {
  const {db} = await fixture(1, 'unknown');
  await db.execute({sql: "UPDATE hub_sources SET is_active=0, discovered_type='unverified' WHERE id=?", args: [SRC]});
  let verified = 0;
  const out = await toggleSource(db, SRC, true, {verify: async () => { verified += 1; return {count: 20}; }});
  assert.equal(verified, 1, 'feed diperiksa otomatis saat dinyalakan');
  assert.equal(out.active, true);
  assert.equal(out.rights, 'permission_confirmed');
  const row = (await db.execute({sql: 'SELECT is_active FROM hub_sources WHERE id=?', args: [SRC]})).rows[0];
  assert.equal(Number(row.is_active), 1);
  await db.close();
});

test('saklar aktif: feed tidak terbaca → sumber tetap mati dan hak tidak berubah', async () => {
  const {db} = await fixture(1, 'metadata_only');
  await db.execute({sql: "UPDATE hub_sources SET is_active=0, discovered_type='unverified' WHERE id=?", args: [SRC]});
  await assert.rejects(() => toggleSource(db, SRC, true, {verify: async () => { throw Error('RSS_INVALID'); }}), /RSS_INVALID/);
  const row = (await db.execute({sql: 'SELECT is_active,rights_status FROM hub_sources WHERE id=?', args: [SRC]})).rows[0];
  assert.equal(Number(row.is_active), 0);
  assert.equal(String(row.rights_status), 'metadata_only');
  await db.close();
});

test('saklar mati: hanya mematikan, pernyataan hak dipertahankan', async () => {
  const {db} = await fixture(1, 'permission_confirmed');
  const out = await toggleSource(db, SRC, false);
  const row = (await db.execute({sql: 'SELECT is_active,rights_status FROM hub_sources WHERE id=?', args: [SRC]})).rows[0];
  assert.equal(Number(row.is_active), 0);
  assert.equal(String(row.rights_status), 'permission_confirmed');
  assert.equal(out.active, false);
  await db.close();
});
