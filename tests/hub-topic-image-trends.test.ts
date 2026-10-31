import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {topicOf} from '../src/server/hub/domain/topic';
import {pickImage} from '../src/server/hub/domain/rss-runtime';
import {articleRow} from '../src/server/hub/domain/publish-delivery';
import {collectTrendRows, publishTrends} from '../src/server/hub/domain/trends-publish';
import {prepareFeatures} from '../src/server/hub/domain/operations';

test('kategori ditentukan kata kunci, bukan selalu "Umum"', () => {
  assert.equal(topicOf({title: 'Polisi tetapkan tersangka kasus penganiayaan di Mataram'}), 'Hukum & Kriminal');
  assert.equal(topicOf({title: 'Harga cabai di pasar naik jelang akhir bulan'}), 'Ekonomi');
  assert.equal(topicOf({title: 'Puskesmas tambah layanan vaksin untuk balita'}), 'Kesehatan');
  assert.equal(topicOf({title: 'Beasiswa untuk mahasiswa NTB dibuka'}), 'Pendidikan');
  assert.equal(topicOf({title: 'Startup lokal rilis aplikasi berbasis kecerdasan buatan'}), 'Teknologi');
  assert.equal(topicOf({title: 'Timnas menang di laga kualifikasi'}), 'Olahraga');
  assert.equal(topicOf({title: 'Bupati resmikan kantor dinas baru'}), 'Info Pemda');
  assert.equal(topicOf({title: 'Sesuatu yang tidak jelas sekali'}), 'Umum');
});

test('kategori dari suntingan manusia dipertahankan', () => {
  const row = articleRow({editorialTitle: 'Judul', originalUrl: 'https://a.test/1', editorialCategory: 'Lingkungan',
    sourcePublishedAt: new Date().toISOString(), sourceRights: 'permission_confirmed'});
  assert.equal(row?.category, 'Lingkungan');
});

test('gambar hanya dipakai bila hak sumber dinyatakan, dan tidak pernah disalin', () => {
  const base = {editorialTitle: 'Judul', originalUrl: 'https://a.test/1', editorialSummary: 'Ringkas',
    sourcePublishedAt: new Date().toISOString(), sourceImageUrl: 'https://cdn.a.test/gambar.jpg', sourceName: 'ANTARA'};
  const withRights = articleRow({...base, sourceRights: 'permission_confirmed'});
  assert.equal(withRights?.image_url, 'https://cdn.a.test/gambar.jpg');
  assert.equal(withRights?.image_credit, 'ANTARA');
  const noRights = articleRow({...base, sourceRights: 'metadata_only'});
  assert.equal(noRights?.image_url, null, 'tanpa pernyataan hak, gambar tidak dipakai');
});

test('pickImage membaca enclosure, media:content, dan <img> dalam konten', () => {
  assert.equal(pickImage({enclosure: {url: 'https://a.test/1.jpg'}}), 'https://a.test/1.jpg');
  assert.equal(pickImage({'media:content': {$: {url: 'https://a.test/2.jpg'}}}), 'https://a.test/2.jpg');
  assert.equal(pickImage({'media:thumbnail': {$: {url: 'https://a.test/3.jpg'}}}), 'https://a.test/3.jpg');
  assert.equal(pickImage({content: '<p><img src="https://a.test/4.jpg"/></p>'}), 'https://a.test/4.jpg');
  assert.equal(pickImage({enclosure: {url: 'http://a.test/insecure.jpg'}}), null, 'hanya https');
  assert.equal(pickImage({}), null);
});

async function trendsFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tr-'));
  const db = createClient({url: 'file:' + path.join(dir, 't.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await prepareFeatures(db);
  const now = new Date().toISOString();
  await db.execute({sql: "INSERT INTO hub_datasets_v3(kind,body,observed_at) VALUES('x',?,?)", args: [JSON.stringify({
    items: [{text: 'Gempa Lombok', rank: 1}, {text: 'Harga Beras', rank: 2}],
    sourceSnapshotAt: now, observedAt: now, origin: 'live', selectionLabel: '1 hour ago', freshnessStatus: 'FRESH'}), now]});
  await db.execute({sql: "INSERT INTO hub_datasets_v3(kind,body,observed_at) VALUES('youtube',?,?)", args: [JSON.stringify({
    items: [{videoId: 'dQw4w9WgXcQ', title: 'Lagu Populer', channel: 'Musik ID'}], observedAt: now, origin: 'live'}), now]});
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return {db, now};
}

test('tren Hub diubah menjadi baris tabel trending portal', async () => {
  const {db, now} = await trendsFixture();
  const rows = await collectTrendRows(db, undefined, Date.parse(now));
  assert.equal(rows.length, 3);
  const x = rows.filter(r => r.platform === 'x_t24');
  assert.equal(x.length, 2);
  // Portal memberi `trending.id` nilai sendiri (GENERATED ALWAYS AS IDENTITY), jadi kitа TIDAK
  // boleh mengirim id: itulah penyebab TRENDS_HTTP_400 sebelumnya.
  assert.equal('id' in x[0], false, 'id tidak boleh dikirim ke portal');
  assert.equal(x[0].source, 'hub');
  assert.ok(x[0].expires_at > new Date(Date.parse(now)).toISOString());
  const yt = rows.filter(r => r.platform === 'yt_feed');
  assert.equal(yt.length, 1);
  assert.match(String(yt[0].image_url), /i\.ytimg\.com/);
  await db.close();
});

test('tren dikirim tanpa id, lalu baris lama dibersihkan memakai id dari server', async () => {
  const {db, now} = await trendsFixture();
  const seen: {url: string; key: string | null; method: string; body: any[]}[] = [];
  const fetcher = (async (input: any, init?: any) => {
    const h = new Headers(init?.headers);
    const method = String(init?.method || 'GET');
    const body = method === 'POST' ? JSON.parse(String(init?.body || '[]')) : [];
    seen.push({url: String(input), key: h.get('apikey'), method, body});
    if (method === 'POST') return new Response(JSON.stringify(body.map((_: unknown, i: number) => ({id: 900 + i}))), {status: 201});
    return new Response(JSON.stringify([{id: 1}, {id: 2}]), {status: 200});
  }) as unknown as typeof fetch;
  const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://site.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'site-key'} as unknown as NodeJS.ProcessEnv;
  const out = await publishTrends(db, {now: Date.parse(now), fetcher, env});
  assert.equal(out.total, 3);
  assert.equal(out.x, 2);
  assert.equal(out.youtube, 1);
  const post = seen.find(s => s.method === 'POST')!;
  assert.ok(post.url.startsWith('https://site.supabase.co/rest/v1/trending'));
  assert.equal(post.key, 'site-key');
  assert.equal(post.body.length, 3);
  assert.ok(post.body.every(r => !('id' in r)), 'tidak ada id dalam payload');
  const del = seen.find(s => s.method === 'DELETE')!;
  assert.match(del.url, /source=eq\.hub/);
  assert.match(del.url, /id=not\.in\.\(900,901,902\)/);
  assert.equal(out.removed, 2);
  await db.close();
});

test('bila portal menolak, sebabnya ikut dilaporkan (bukan hanya kode kosong)', async () => {
  const {db, now} = await trendsFixture();
  const fetcher = (async () => new Response('{"code":"428C9","message":"cannot insert a non-DEFAULT value into column \"id\""}', {status: 400})) as unknown as typeof fetch;
  const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://site.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'site-key'} as unknown as NodeJS.ProcessEnv;
  await assert.rejects(() => publishTrends(db, {now: Date.parse(now), fetcher, env}), (e: Error) => {
    assert.match(e.message, /TRENDS_HTTP_400/);
    assert.match(e.message, /cannot insert a non-DEFAULT value/);
    return true;
  });
  await db.close();
});

test('tanpa kredensial, tren tidak dikirim dan tidak ada jaringan', async () => {
  const {db} = await trendsFixture();
  let calls = 0;
  const fetcher = (async () => { calls += 1; throw Error('tidak boleh'); }) as unknown as typeof fetch;
  await assert.rejects(() => publishTrends(db, {fetcher, env: {} as unknown as NodeJS.ProcessEnv}), /PUBLISH_TARGET_NOT_CONFIGURED/);
  assert.equal(calls, 0);
  await db.close();
});

test('gambar untuk berita lama diisi saat feed kembali memuat item yang sama', async () => {
  const {db} = await (async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'imgfill-'));
    const client = createClient({url: 'file:' + path.join(dir, 'i.db')});
    await client.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
    await prepareFeatures(client);
    const close = client.close.bind(client);
    (client as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
    return {db: client};
  })();
  const SRC = 'bbbbbbbb-1111-1111-1111-111111111111';
  await db.execute({
    sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,is_active,discovered_type,feed_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,'rss',?,?,?)",
    args: [SRC, 'media', 'Provinsi', 'NTB', 'https://a.test', 'https://a.test', 'a.test', 'rss', 'permission_confirmed', 'https://a.test/rss', '2026-10-31', '2026-10-31'],
  });
  // Berita lama: sudah ada, tanpa gambar.
  await db.execute({
    sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_published_at,first_seen_at,last_seen_at,version,review_state) VALUES('old',?,?,?,?,?,?,?,?,1,'pending_review')",
    args: [SRC, 'url:https://a.test/1', 'https://a.test/1', 'https://a.test/1', 'Judul lama', '2026-10-31T09:00:00.000Z', '2026-10-31', '2026-10-31'],
  });
  // Simulasi hasil pickImage dari item feed yang sama.
  assert.equal(pickImage({enclosure: {url: 'https://cdn.a.test/lama.jpg'}}), 'https://cdn.a.test/lama.jpg');
  await db.execute({sql: 'UPDATE hub_items SET source_image_url=? WHERE id=? AND source_image_url IS NULL', args: ['https://cdn.a.test/lama.jpg', 'old']});
  const row = (await db.execute("SELECT source_image_url,version FROM hub_items WHERE id='old'")).rows[0];
  assert.equal(String(row.source_image_url), 'https://cdn.a.test/lama.jpg');
  assert.equal(Number(row.version), 1, 'versi tidak berubah, edit manual tetap aman');
  await db.close();
});
