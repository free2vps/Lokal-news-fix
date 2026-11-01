import test from 'node:test';
import assert from 'node:assert/strict';
import {discover} from '../src/server/hub/domain/discovery';

const RSS_FRESH = `<?xml version="1.0"?><rss version="2.0"><channel><title>Contoh</title>
  <item><title>Berita Baru Satu</title><pubDate>${new Date().toUTCString()}</pubDate><link>https://a.test/1</link></item>
  <item><title>Berita Baru Dua</title><pubDate>${new Date(Date.now() - 3600000).toUTCString()}</pubDate><link>https://a.test/2</link></item>
</channel></rss>`;
const RSS_STALE = `<?xml version="1.0"?><rss version="2.0"><channel><title>Contoh</title>
  <item><title>Berita Lama</title><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate><link>https://a.test/9</link></item>
</channel></rss>`;
const SITEMAP = `<?xml version="1.0"?><urlset><url><loc>https://b.test/berita/judul-panjang-sekali-satu</loc><lastmod>${new Date().toISOString()}</lastmod></url>
  <url><loc>https://b.test/berita/judul-panjang-sekali-dua</loc></url></urlset>`;
const LISTING_HTML = `<html><body><div class="grid">
  ${[1, 2, 3, 4].map(n => `<div class="card">
    <a href="https://b.test/blog/artikel-panjang-nomor-${n}"><picture><source srcset="https://cdn.c.test/${n}.webp"><img src="/p.png"></picture></a>
    <div class="flex"><div class="rounded-full"> Hiburan </div><div class="ml-auto"> 0${n} Oct 2026 </div></div>
    <a href="https://b.test/blog/artikel-panjang-nomor-${n}"> Artikel Nomor ${n} </a></div>`).join('')}
</div></body></html>`;

function fetcher(map: Record<string, string | (() => never)>) {
  return async (url: string) => {
    const hit = map[url] ?? map[new URL(url).pathname];
    if (typeof hit === 'function') throw hit();
    if (typeof hit === 'string') return hit;
    throw Error('HTTP_404');
  };
}

test('RSS segar dipakai lebih dulu — tidak mencari jalur lain', async () => {
  let calls = 0;
  const load = async (url: string) => {
    calls += 1;
    if (url.endsWith('/feed') || url.endsWith('/rss')) return RSS_FRESH;
    if (url === 'https://a.test/') return '<html><body>beranda</body></html>';
    throw Error('HTTP_404');
  };
  const d = await discover('https://a.test/', {fetcher: load});
  assert.equal(d.method, 'rss');
  assert.equal(d.stale, false);
  assert.ok(d.items >= 2);
  assert.ok(calls <= 4, 'tidak perlu memeriksa semua jalur');
});

test('RSS basi → otomatis pindah ke halaman daftar yang segar', async () => {
  const load = fetcher({
    '/feed': RSS_STALE, '/rss': RSS_STALE,
    'https://b.test/': LISTING_HTML,
  });
  const d = await discover('https://b.test/', {fetcher: load});
  assert.equal(d.method, 'listing');
  assert.equal(d.stale, false);
  assert.match(d.notes.join(' '), /RSS ditemukan tetapi isi terbaru/);
});

test('tanpa RSS → sitemap dipakai', async () => {
  const load = fetcher({'https://b.test/sitemap.xml': SITEMAP});
  const d = await discover('https://b.test/', {fetcher: load});
  assert.equal(d.method, 'sitemap');
  assert.equal(d.endpoint, 'https://b.test/sitemap.xml');
  assert.equal(d.items, 2);
});

test('RSS basi dan tanpa daftar artikel → RSS dilaporkan beserta peringatan basi', async () => {
  const load = fetcher({'/feed': RSS_STALE, 'https://b.test/': '<html><body>kosong</body></html>'});
  const d = await discover('https://b.test/', {fetcher: load});
  assert.equal(d.method, 'rss');
  assert.equal(d.stale, true);
});

test('alamat yang ditempel sudah berupa feed → langsung dipakai', async () => {
  const load = fetcher({'https://a.test/rss.xml': RSS_FRESH});
  const d = await discover('https://a.test/rss.xml', {fetcher: load});
  assert.equal(d.method, 'rss');
  assert.equal(d.endpoint, 'https://a.test/rss.xml');
});

test('tidak ada apa pun → metode none, tidak melempar', async () => {
  const d = await discover('https://z.test/', {fetcher: async () => { throw Error('HTTP_403'); }});
  assert.equal(d.method, 'none');
  assert.equal(d.items, 0);
});

test('situs yang menolak program (403/Cloudflare) dilaporkan JUJUR, bukan "tidak ada berita"', async () => {
  const d = await discover('https://terkunci.test/', {fetcher: async () => { throw Error('HTTP_403'); }});
  assert.equal(d.method, 'none');
  const notes = d.notes.join(' ');
  assert.match(notes, /menolak program/i, 'sebabnya harus disebut');
  assert.match(notes, /robots\.txt/i, 'alasannya: robots pun tak terbaca');
  assert.match(notes, /PortalContentHub/i, 'ada saran tindakan yang bisa dilakukan pemilik situs');
});

test('alamat kategori yang ditempel TIDAK diganti beranda walau beranda punya lebih banyak artikel', async () => {
  // Bentuk kartu mengikuti fixture BeautyHaul yang sudah terbukti terbaca ekstraktor.
  const card = (slug: string, judul: string, tanggal: string) => `
  <div class="card">
    <a href="https://www.beautyhaul.com/blog/${slug}">
      <picture><source srcset="https://cdn.beautyhaul.com/assets/uploads/thumbs/${slug}.webp 1x"><img src="/blog/static/assets/placeholder/image-placeholder-square.png" alt=""></picture>
      <h3>${judul}</h3>
    </a>
    <span>Film &amp; Series</span><span>${tanggal}</span>
  </div>`;
  const kategori = `<html><body><div class="grid">
    ${card('rekomendasi-5-drakor-oktober', 'Rekomendasi 5 Drakor Wajib Tonton Bulan Oktober', '09 Oktober 2026')}
    ${card('dracin-percintaan-kantor', 'Ini 4 Dracin Soal Percintaan di Kantor', '02 September 2026')}
    ${card('drakor-rilis-agustus', '5 Drakor Terbaru Bulan Agustus', '13 Agustus 2026')}
  </div></body></html>`;
  const beranda = `<html><body><div class="grid">
    ${Array.from({length: 12}, (_, i) => card(`skincare-nomor-${i}`, `Rekomendasi Skincare Nomor ${i}`, `0${(i % 9) + 1} Oktober 2026`)).join('')}
  </div></body></html>`;
  const fetcher = async (u: string) => (/film-series/.test(u) ? kategori : beranda);
  const d = await discover('https://www.beautyhaul.com/blog/film-series', {fetcher});
  assert.equal(d.method, 'listing');
  assert.match(String(d.endpoint), /film-series/, 'endpoint harus alamat yang ditempel, bukan beranda');
  assert.equal(d.items, 3);
});
