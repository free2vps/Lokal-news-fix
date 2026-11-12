import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareSocialSchema, enqueuePublished, claimBatch, acknowledge, SOCIAL_POLICY} from '../src/server/hub/domain/social-pull';

async function siap() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dedup-'));
  const db = createClient({url: 'file:' + path.join(dir, 't.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await prepareSocialSchema(db);
  return {db, dir};
}

async function artikel(db: any, id: string, url: string) {
  const now = new Date().toISOString();
  await db.execute({sql: `INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,
      source_kind,discovered_type,feed_url,rights_status,is_active,created_at,updated_at)
    VALUES('s1','Sumber','NTB','NTB','https://a.test/feed','https://a.test/feed','a.test','rss','rss',
      'https://a.test/feed','permission_confirmed',1,?,?)`, args: [now, now]});
  await db.execute({sql: `INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,
      source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category,version,review_state,approved_version)
    VALUES(?, 's1', ?, ?, ?, 'Judul', ?, ?, ?, 'Judul', 'Ringkasan cukup panjang untuk diposting.', 'Umum', 1,'approved',1)`,
    args: [id, id, url, url, now, now, now]});
  await db.execute({sql: `INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES(?,1,'{}',?,'uji')`,
    args: [id, now]});
  await db.execute({sql: `INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at)
    VALUES(?,?,?,1,'{}','published',?)`, args: ['o-' + id, 'k-' + id, id, now]});
}

test('artikel yang SUDAH terkirim tidak masuk antrean lagi walau versinya berubah', async () => {
  const {db, dir} = await siap();
  try {
    await artikel(db, 'i1', 'https://a.test/1');
    const pertama = await enqueuePublished(db);
    assert.equal(pertama.inserted, 1);

    const klaim = await claimBatch(db, {label: 'make', max: 4});
    assert.equal(klaim.count, 1);
    await acknowledge(db, [{deliveryKey: klaim.items[0].deliveryKey, ok: true}], 'make');

    // Artikel disunting → versi naik → outbox baru dengan approved_version 2.
    await db.execute({sql: "UPDATE hub_items SET version=2, approved_version=2 WHERE id='i1'"});
    await db.execute({sql: "INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES('i1',2,'{}',?,'uji')", args: [new Date().toISOString()]});
    const now = new Date().toISOString();
    await db.execute({sql: `INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at)
      VALUES('o2','k2','i1',2,'{}','published',?)`, args: [now]});

    const kedua = await enqueuePublished(db);
    assert.equal(kedua.inserted, 0, 'tidak boleh masuk antrean kedua kali');
    assert.ok(kedua.dilewati >= 1, 'harus tercatat sebagai dilewati (outbox lama + baru, artikel sama)');

    const klaim2 = await claimBatch(db, {label: 'make', max: 4});
    assert.equal(klaim2.count, 0, 'tidak ada yang bisa diklaim untuk artikel yang sama');
  } finally { await db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('baris antrean ganda yang sudah telanjur ada ikut dibersihkan saat klaim', async () => {
  const {db, dir} = await siap();
  try {
    await artikel(db, 'i2', 'https://a.test/2');
    await enqueuePublished(db);
    const klaim = await claimBatch(db, {label: 'make', max: 4});
    await acknowledge(db, [{deliveryKey: klaim.items[0].deliveryKey, ok: true}], 'make');

    // Tiru keadaan lama: baris pending kedua untuk artikel yang sama, versi berbeda.
    const now = new Date().toISOString();
    await db.execute({sql: `INSERT INTO hub_social_queue_v2(delivery_key,item_id,item_version,status,created_at,updated_at)
      VALUES('dupdupdupdupdupdupdupdupdupdup32','i2',9,'pending',?,?)`, args: [now, now]});

    const klaim2 = await claimBatch(db, {label: 'make', max: 4});
    assert.equal(klaim2.count, 0);
    const row: any = (await db.execute({sql: "SELECT status,last_error FROM hub_social_queue_v2 WHERE item_id='i2' AND item_version=9"})).rows[0];
    assert.equal(row.status, 'skipped');
    assert.equal(row.last_error, 'ALREADY_POSTED');
  } finally { await db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('percobaan ulang dikurangi menjadi satu kali saja', () => {
  assert.equal(SOCIAL_POLICY.maxAttempts, 2, 'dari 5 → 2: kiriman ganda lebih merugikan daripada satu berita tidak terkirim');
});

test('kode memasang indeks unik satu-kiriman-per-artikel', () => {
  const isi = readFileSync('src/server/hub/domain/social-pull.ts', 'utf8');
  assert.match(isi, /hub_social_one_delivery/);
  assert.match(isi, /UNIQUE INDEX IF NOT EXISTS hub_social_one_delivery ON hub_social_queue_v2\(item_id\) WHERE status='delivered'/);
});
