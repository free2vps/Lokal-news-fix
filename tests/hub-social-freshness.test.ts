import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareSocialSchema, enqueuePublished, claimBatch, acknowledge, socialStatus, SOCIAL_POLICY} from '../src/server/hub/domain/social-pull';

/**
 * Masalah yang dijaga tes ini:
 * Kalau berita terbit lebih cepat daripada laju posting Make, antrean akan menumpuk
 * dan yang diposting selalu berita lama. Solusinya: ambil TERBARU dulu + buang yang basi.
 */

const SITE = 'https://contoh-situs.example';
const JAM = 3600000;

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'social-fresh-'));
  const db = createClient({url: 'file:' + path.join(dir, 's.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute("INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES('s1','Media NTB','Provinsi','NTB','https://satu.example.org','https://satu.example.org','satu.example.org','rss','permission_confirmed','2026-10-30','2026-10-30')");
  await prepareSocialSchema(db);
  const close = db.close.bind(db);
  (db as any).close = async (...args: any[]) => { await (close as any)(...args); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return db;
}

/** Masukkan satu artikel yang terbit pada waktu tertentu. */
async function terbitkan(db: any, i: number, terbitMs: number, version = 1) {
  const id = `news:${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`;
  const judul = `Berita nomor ${i}`;
  const waktu = new Date(terbitMs).toISOString();
  const snapshot = JSON.stringify({id, sourceId: 's1', originalUrl: 'https://satu.example.org/' + i, sourceTitle: judul, sourceSnippet: 'Ringkas ' + i, sourcePublishedAt: waktu, editorialTitle: judul, editorialSummary: 'Ringkasan ' + i, editorialCategory: 'Pendidikan', version});
  await db.execute({
    sql: "INSERT OR REPLACE INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category,version,review_state,approved_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    args: [id, 's1', 'k' + i, 'https://satu.example.org/' + i, 'https://satu.example.org/' + i, judul, 'Ringkas ' + i, waktu, waktu, waktu, judul, 'Ringkasan ' + i, 'Pendidikan', version, 'approved', version],
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES(?,?,?,?,?)",
    args: [id, version, snapshot, waktu, 'owner'],
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at) VALUES(?,?,?,?,?,'published',?)",
    args: ['o' + i, 'k' + i, id, version, snapshot, waktu],
  });
  return id;
}

test('antrean mengambil berita TERBARU dulu, bukan yang paling lama menunggu', async () => {
  const db = await fixture();
  try {
    const now = Date.now();
    // 5 berita: paling tua 5 jam, paling baru 1 jam.
    for (let i = 1; i <= 5; i++) await terbitkan(db, i, now - (6 - i) * JAM);
    await enqueuePublished(db, now);

    const out = await claimBatch(db, {max: 2, label: 'make', now, env: {} as any});
    assert.equal(out.count, 2);
    const jam = out.items.map((it) => it.ageHours);
    assert.deepEqual(jam, [1, 2], 'yang diambil harus yang termuda (1 jam & 2 jam), bukan yang tertua');
  } finally { await db.close(); }
});

test('berita lebih tua dari 6 jam ditandai basi dan TIDAK diposting', async () => {
  const db = await fixture();
  try {
    const now = Date.now();
    await terbitkan(db, 1, now - 20 * JAM); // 20 jam — basi
    await terbitkan(db, 2, now - 3 * JAM); // segar
    await enqueuePublished(db, now);        // hanya yang ≤6 jam masuk antrean

    const out = await claimBatch(db, {max: 4, label: 'make', now, env: {} as any});
    assert.equal(out.count, 1);
    assert.equal(out.items[0].title, 'Berita nomor 2');
  } finally { await db.close(); }
});

test('antrean lama yang sudah telanjur menumpuk dibersihkan, tidak dikirim telat', async () => {
  const db = await fixture();
  try {
    const now = Date.now();
    // Tiru tumpukan lama: 8 berita berumur 7–14 jam yang sudah telanjur pending di antrean.
    for (let i = 1; i <= 8; i++) {
      const id = await terbitkan(db, i, now - (6 + i) * JAM);
      await db.execute({sql: "INSERT INTO hub_social_queue_v2(delivery_key,item_id,item_version,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)",
        args: [String(i).padStart(32, 'a'), id, 1, new Date(now - (6 + i) * JAM).toISOString(), new Date(now).toISOString()]});
    }
    const sebelum = await socialStatus(db);
    assert.equal(sebelum.pending, 8);

    const out = await claimBatch(db, {max: 4, label: 'make', now, env: {} as any});
    assert.equal(out.count, 0, 'tidak ada yang boleh diposting karena semuanya basi');
    assert.equal(out.expiredNow, 8, 'delapan item basi harus dibuang');
    const sesudah = await socialStatus(db);
    assert.equal(sesudah.pending, 0, 'antrean tidak lagi menumpuk');
    assert.equal(sesudah.stale, 8);
  } finally { await db.close(); }
});

test('kuota harian membatasi jumlah kiriman per 24 jam', async () => {
  const db = await fixture();
  try {
    const now = Date.now();
    for (let i = 1; i <= 6; i++) await terbitkan(db, i, now - i * 60000); // semua baru (≤6 menit)
    await enqueuePublished(db, now);

    const tarik = await claimBatch(db, {max: 4, label: 'make', now, env: {} as any, cap: 3});
    assert.equal(tarik.count, 3, 'kuota 3/hari → hanya 3 diambil');
    await acknowledge(db, tarik.items.map((i) => ({deliveryKey: i.deliveryKey, ok: true})), 'make', now);

    const lagi = await claimBatch(db, {max: 4, label: 'make', now: now + 60_000, env: {} as any, cap: 3});
    assert.equal(lagi.count, 0);
    assert.equal(lagi.reason, 'DAILY_CAP_REACHED');
  } finally { await db.close(); }
});

test('kuota bergulir 24 jam: kiriman kemarin tidak memblokir hari ini', async () => {
  const db = await fixture();
  try {
    const now = Date.now();
    for (let i = 1; i <= 4; i++) await terbitkan(db, i, now - i * 60000);
    await enqueuePublished(db, now);
    const tarik = await claimBatch(db, {max: 2, label: 'make', now, env: {} as any, cap: 2});
    await acknowledge(db, tarik.items.map((i) => ({deliveryKey: i.deliveryKey, ok: true})), 'make', now);

    // 25 jam kemudian: berita baru terbit, kuota sudah bergulir.
    const besok = now + 25 * JAM;
    await terbitkan(db, 99, besok - 5 * 60000);
    await enqueuePublished(db, besok);
    const lagi = await claimBatch(db, {max: 2, label: 'make', now: besok, env: {} as any, cap: 2});
    assert.equal(lagi.count, 1);
    assert.equal(lagi.deliveredLast24h, 0);
  } finally { await db.close(); }
});

test('kebijakan baru tercatat dan bisa dibaca panel', async () => {
  assert.equal(SOCIAL_POLICY.maxAgeHours, 6);
  assert.equal(SOCIAL_POLICY.dailyPostCap, 16);
  assert.equal(SOCIAL_POLICY.pullOrder, 'newest_first');
  const db = await fixture();
  try {
    const s = await socialStatus(db);
    assert.equal(s.backlogHealthy, true);
    assert.equal(s.deliveredLast24h, 0);
  } finally { await db.close(); }
});
