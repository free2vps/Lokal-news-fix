import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  prepareYoutubeSchema, saveYoutubeKey, clearYoutubeKey, youtubeKeyStatus,
  mapApiResponse, fetchPlaylistViaApi, pullYoutube, YT_API_POLICY,
} from '../src/server/hub/domain/youtube-source';

/**
 * Kenyataan yang dijaga tes ini (diperiksa langsung 2 Nov 2026):
 *   https://www.youtube.com/robots.txt  →  Disallow: /feeds/videos.xml
 * Jadi feed RSS playlist DILARANG. Sesuai aturan proyek, kita tidak menembusnya.
 * Jalur sah: YouTube Data API v3 dengan kunci.
 */

const MASTER = Buffer.alloc(32, 7).toString('base64');
const KEY = 'AIzaSyD-contoh-kunci-yang-panjang-1234567';

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  const db = createClient({url: 'file:' + path.join(dir, 'y.db')});
  await prepareYoutubeSchema(db);
  return {db, dir};
}

test('tanpa kunci: penarikan DITOLAK dengan pesan yang bisa ditindaklanjuti', async () => {
  const {db, dir} = await fixture();
  try {
    await assert.rejects(() => pullYoutube(db, 'OL1234567890', MASTER, (async () => { throw Error('tidak boleh dipanggil'); }) as any),
      /YOUTUBE_API_KEY_REQUIRED/, 'tidak boleh mencoba menembus robots.txt');
  } finally { await db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('kunci disimpan terenkripsi dan tidak pernah dikembalikan sebagai teks biasa', async () => {
  const {db, dir} = await fixture();
  try {
    const hasil = await saveYoutubeKey(db, KEY, MASTER);
    assert.equal(hasil.keyConfigured, true);
    assert.equal(hasil.keyHint, 'AIza…4567');
    assert.ok(!JSON.stringify(hasil).includes(KEY), 'nilai kunci tidak boleh ikut keluar');
    const simpan = String((await db.execute('SELECT key_ciphertext FROM hub_youtube_key_v1')).rows[0].key_ciphertext);
    assert.ok(!simpan.includes(KEY), 'di database harus tersandi');
    const status = await youtubeKeyStatus(db, MASTER);
    assert.equal(status.keyConfigured, true);
    assert.equal(status.keyReadable, true);
    assert.equal(status.feedBlockedByRobots, true);
    assert.ok(!JSON.stringify(status).includes(KEY));
  } finally { await db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('kunci tidak sah ditolak', async () => {
  const {db, dir} = await fixture();
  try {
    await assert.rejects(() => saveYoutubeKey(db, 'pendek', MASTER), /YOUTUBE_KEY_INVALID/);
    await assert.rejects(() => saveYoutubeKey(db, 'ada spasi di dalam kunci ini panjang', MASTER), /YOUTUBE_KEY_INVALID/);
    await assert.rejects(() => saveYoutubeKey(db, KEY, undefined), /MASTER_KEY_REQUIRED/);
  } finally { await db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('kunci bisa dihapus dan statusnya kembali "belum diisi"', async () => {
  const {db, dir} = await fixture();
  try {
    await saveYoutubeKey(db, KEY, MASTER);
    await clearYoutubeKey(db);
    const s = await youtubeKeyStatus(db, MASTER);
    assert.equal(s.keyConfigured, false);
    assert.equal(s.keyHint, null);
  } finally { await db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('jawaban API dipetakan; item tanpa videoId sah dibuang, bukan dikarang', () => {
  const payload = {items: [
    {snippet: {title: 'Video bagus', channelTitle: 'Kanal NTB', publishedAt: '2026-11-01T10:00:00Z', resourceId: {videoId: 'dQw4w9WgXcQ'}}},
    {snippet: {title: '', resourceId: {videoId: 'aaaaaaaaaaa'}}},
    {snippet: {title: 'ID rusak', resourceId: {videoId: 'pendek'}}},
    {snippet: {title: 'Kembar', resourceId: {videoId: 'dQw4w9WgXcQ'}}},
  ]};
  const out = mapApiResponse(payload);
  assert.equal(out.length, 1);
  assert.equal(out[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(out[0].videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(out[0].channel, 'Kanal NTB');
  assert.deepEqual(mapApiResponse(null), []);
  assert.deepEqual(mapApiResponse({}), []);
});

test('penarikan API memakai parameter yang benar dan tidak menyentuh robots.txt', async () => {
  let dipanggil = '';
  const fetcher = (async (url: string) => {
    dipanggil = String(url);
    return new Response(JSON.stringify({items: [{snippet: {title: 'Satu', channelTitle: 'K', resourceId: {videoId: 'abcdefghijk'}}}]}), {status: 200});
  }) as any;
  const out = await fetchPlaylistViaApi('OL1234567890', KEY, fetcher);
  assert.equal(out.length, 1);
  const u = new URL(dipanggil);
  assert.equal(u.origin + u.pathname, 'https://www.googleapis.com/youtube/v3/playlistItems');
  assert.equal(u.searchParams.get('playlistId'), 'OL1234567890');
  assert.equal(u.searchParams.get('part'), 'snippet');
  assert.equal(u.searchParams.get('key'), KEY);
  assert.equal(Number(u.searchParams.get('maxResults')), YT_API_POLICY.maxResults);
  assert.ok(!dipanggil.includes('youtube.com/feeds'), 'jalur terlarang tidak boleh dipakai');
});

test('galat API dibawa apa adanya supaya tidak menebak', async () => {
  const fetcher = (async () => new Response(JSON.stringify({error: {message: 'API key not valid'}}), {status: 400})) as any;
  await assert.rejects(() => fetchPlaylistViaApi('OL1', KEY, fetcher), /YOUTUBE_API_400.*API key not valid/);
});

test('dengan kunci tersimpan, penarikan memakai API', async () => {
  const {db, dir} = await fixture();
  try {
    await saveYoutubeKey(db, KEY, MASTER);
    const fetcher = (async () => new Response(JSON.stringify({items: [{snippet: {title: 'Berita video', channelTitle: 'K', resourceId: {videoId: 'zzzzzzzzzzz'}}}]}), {status: 200})) as any;
    const out = await pullYoutube(db, 'OL999', MASTER, fetcher);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Berita video');
  } finally { await db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('tombol "Perbarui manual" meneruskan kunci master dan langsung mengirim ke beranda', () => {
  // BUG nyata r51: route memanggil syncYoutube(a.db) TANPA master, sehingga kunci API
  // yang sudah disimpan tidak bisa dibuka → tarikan gagal walau kuncinya benar.
  const isi = readFileSync('src/app/api/hub/workspace/route.ts', 'utf8');
  assert.ok(/syncYoutube\(a\.db,\s*process\.env\.HUB_MASTER_KEY\)/.test(isi),
    'kunci master wajib diteruskan ke syncYoutube');
  assert.ok(!/syncYoutube\(a\.db\)/.test(isi), 'tidak boleh memanggil tanpa master');
  assert.ok(isi.includes('publishTrends'), 'setelah tarik manual, tren harus dikirim ke beranda');
});
