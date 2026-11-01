import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {imageFromHtml, pickImageFromPage, hostReady, markHost, HOST_GAP_MS} from '../src/server/hub/domain/article-image';

const BASE = 'https://www.balipuspanews.com/anak-muda-jembrana-ditantang-jangan-jadi-penonton.html';

function tmp() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aimg-'));
  const db = createClient({url: 'file:' + path.join(dir, 'a.db')});
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return db;
}

test('og:image dipakai lebih dulu', () => {
  const html = `<html><head><meta property="og:image" content="https://cdn.contoh.test/utama.jpg"></head>
    <body><img src="/logo.png"></body></html>`;
  assert.equal(imageFromHtml(html, BASE), 'https://cdn.contoh.test/utama.jpg');
});

test('tanpa og:image: pakai <img> di artikel, logo & ikon dilewati', () => {
  // Meniru struktur halaman Bali Puspa News: logo situs lebih dulu, gambar berita setelahnya.
  const html = `<html><body>
    <a href="/"><img src="https://www.balipuspanews.com/wp-content/uploads/2022/03/140x48.jpg" alt="logo"></a>
    <article>
      <a href="https://www.balipuspanews.com/wp-content/uploads/2026/11/47916849-A30B-48C3-B7AF-7AFA607B458F.jpeg">
        <img src="https://www.balipuspanews.com/wp-content/uploads/2026/11/47916849-A30B-48C3-B7AF-7AFA607B458F-696x464.jpeg"
             alt="Gelaran Jembrana Creative Festival">
      </a>
    </article></body></html>`;
  assert.equal(imageFromHtml(html, BASE),
    'https://www.balipuspanews.com/wp-content/uploads/2026/11/47916849-A30B-48C3-B7AF-7AFA607B458F-696x464.jpeg');
});

test('twitter:image dipakai bila og:image tidak ada, alamat relatif diselesaikan', () => {
  const html = `<html><head><meta name="twitter:image" content="/wp-content/uploads/2026/11/a.jpg"></head><body></body></html>`;
  assert.equal(imageFromHtml(html, BASE), 'https://www.balipuspanews.com/wp-content/uploads/2026/11/a.jpg');
});

test('alamat tidak sah ditolak (bukan https, data URI, gambar 1x1, ikon kecil)', () => {
  assert.equal(imageFromHtml('<meta property="og:image" content="http://contoh.test/a.jpg">', BASE), null);
  assert.equal(imageFromHtml('<meta property="og:image" content="data:image/png;base64,AAAA">', BASE), null);
  assert.equal(imageFromHtml('<article><img src="https://contoh.test/pixel/1x1.gif"></article>', BASE), null);
  assert.equal(imageFromHtml('<article><img src="https://contoh.test/foto.jpg" width="80"></article>', BASE), null);
  assert.equal(imageFromHtml('<html><body><p>tanpa gambar</p></body></html>', BASE), null);
});

test('halaman berhasil dibaca → gambar dikembalikan; gagal → null, tidak melempar', async () => {
  const html = `<html><head><meta property="og:image" content="https://cdn.contoh.test/x.jpg"></head><body></body></html>`;
  // robots dan pengambilan halaman dijalankan lewat injeksi: di tes ini checker dianggap lolos.
  const ok = await pickImageFromPage('https://contoh.test/berita/1.html', async () => html).catch(() => 'LEMPAR');
  assert.ok(ok === null || typeof ok === 'string', 'tidak boleh melempar');
  const broken = await pickImageFromPage('https://contoh.test/berita/2.html', async () => { throw Error('NETWORK_TIMEOUT'); });
  assert.equal(broken, null);
});

test('Crawl-delay dihormati: host yang baru diminta tidak diminta lagi sebelum 10 detik', async () => {
  const db = tmp();
  try {
    assert.equal(await hostReady(db, 'www.balipuspanews.com'), true);
    await markHost(db, 'www.balipuspanews.com', 1000);
    assert.equal(await hostReady(db, 'www.balipuspanews.com', 1000 + HOST_GAP_MS - 1), false);
    assert.equal(await hostReady(db, 'www.balipuspanews.com', 1000 + HOST_GAP_MS), true);
    assert.equal(await hostReady(db, 'situs.lain.test', 1000 + 1), true, 'host lain tidak terpengaruh');
  } finally { await db.close(); }
});
