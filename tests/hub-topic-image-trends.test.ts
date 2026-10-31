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
  assert.equal(x[0].id, 'hub-x_t24-1');
  assert.ok(x[0].expires_at > new Date(Date.parse(now)).toISOString());
  const yt = rows.filter(r => r.platform === 'yt_feed');
  assert.equal(yt.length, 1);
  assert.match(String(yt[0].image_url), /i\.ytimg\.com/);
  await db.close();
});

test('tren dikirim ke Supabase dengan kredensial situs dan menimpa baris yang sama', async () => {
  const {db, now} = await trendsFixture();
  const seen: {url: string; key: string | null; body: any[]}[] = [];
  const fetcher = (async (input: any, init?: any) => {
    const h = new Headers(init?.headers);
    seen.push({url: String(input), key: h.get('apikey'), body: JSON.parse(String(init?.body || '[]'))});
    return new Response(null, {status: 201});
  }) as unknown as typeof fetch;
  const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://site.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'site-key'} as unknown as NodeJS.ProcessEnv;
  const out = await publishTrends(db, {now: Date.parse(now), fetcher, env});
  assert.equal(out.total, 3);
  assert.equal(out.x, 2);
  assert.equal(out.youtube, 1);
  assert.ok(seen[0].url.startsWith('https://site.supabase.co/rest/v1/trending'));
  assert.equal(seen[0].key, 'site-key');
  assert.equal(seen[0].body.length, 3);
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
