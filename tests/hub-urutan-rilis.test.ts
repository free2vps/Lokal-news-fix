import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeFeed} from '../src/lib/feed-merge';

const tanpaKomentar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
const q = tanpaKomentar(readFileSync('src/lib/queries.ts', 'utf8'));

type A = {id: number; slug: string; source_url: string; published_at: string; title: string; jenis_sumber?: string; category?: string; section?: string};
const buat = (id: number, tgl: string, jenis = 'media'): A =>
  ({id, slug: `s-${id}`, source_url: `https://x.test/${id}`, published_at: tgl, title: `Berita ${id}`, jenis_sumber: jenis, category: 'Info Pemda', section: 'berita'});

test('daftar kategori: rilis pemda didahulukan walau tanggalnya lebih tua', () => {
  // Simulasi: snapshot editorial hanya berisi 72 jam terakhir (12 Nov), rilis 9–10 Nov.
  const snapshot = [buat(1, '2026-11-12T01:00:00Z'), buat(2, '2026-11-11T20:00:00Z')];
  const sorot = [buat(1107, '2026-11-10T00:00:00Z', 'rilis'), buat(1108, '2026-11-09T00:00:00Z', 'rilis')];
  const hasil = mergeFeed([...sorot, ...snapshot], [], 12, 0) as A[];
  assert.deepEqual(hasil.map(a => a.id), [1107, 1108, 1, 2]);
});

test('rilis yang disorot tidak mengacaukan halaman berikutnya (LoadMore)', () => {
  const snapshot = Array.from({length: 20}, (_, i) => buat(i + 1, new Date(Date.parse('2026-11-12T01:00:00Z') - i * 3600_000).toISOString()));
  const sorot = [buat(1107, '2026-11-10T00:00:00Z', 'rilis'), buat(1108, '2026-11-09T00:00:00Z', 'rilis')];
  const h1 = mergeFeed([...sorot, ...snapshot], [], 12, 0) as A[];
  const h2 = mergeFeed([...sorot, ...snapshot], [], 12, 12) as A[];
  assert.equal(h1[0].id, 1107, 'rilis di posisi teratas halaman 1');
  assert.equal(h1.length, 12);
  assert.ok(!h2.some(a => a.id === 1107 || a.id === 1108), 'rilis tidak boleh muncul dua kali di halaman 2');
  const semua = [...h1, ...h2].map(a => a.id);
  assert.equal(new Set(semua).size, semua.length, 'tidak ada artikel yang berulang di dua halaman');
});

test('beranda TIDAK tersentuh: penyorotan hanya bila tidak ada batas umur (sinceHours)', () => {
  assert.match(q, /const sorot=!sinceHours&&\(category\|\|section\)/, 'penyorotan harus mensyaratkan tanpa sinceHours');
  // Beranda memang memakai sinceHours — pastikan nilainya masih ada.
  const beranda = tanpaKomentar(readFileSync('src/app/(public)/page.tsx', 'utf8'));
  assert.match(beranda, /FEED_HOURS\s*=\s*36/);
  assert.match(beranda, /sinceHours:\s*FEED_HOURS/);
});

test('urutan rilis diterapkan di dua jalur: cache DB dan suntikan snapshot', () => {
  // Jalur 1: bila Hub nonaktif, daftar diambil langsung dari database dengan urutan rilis dulu.
  assert.match(q, /\.order\('jenis_sumber',\s*\{\s*ascending:\s*false\s*\}\)/);
  assert.ok(q.indexOf("order('jenis_sumber'") < q.indexOf("order('published_at'"), 'jenis_sumber harus diurutkan lebih dulu');
  // Jalur 2: rilis dibaca terpisah karena snapshot editorial hanya 72 jam.
  assert.match(q, /eq\('jenis_sumber',\s*'rilis'\)/);
  assert.match(q, /mergeFeed\(\[\.\.\.sorot,\.\.\.rows\]/);
});

test('yang diubah hanya urutan — tanggal terbit tidak pernah ditulis ulang', () => {
  assert.ok(!/update\([\s\S]{0,200}published_at/.test(q), 'queries.ts tidak boleh mengubah tanggal terbit');
  assert.ok(!/published_at:\s*new Date\(\)/.test(q), 'tidak boleh mengisi tanggal dengan waktu sekarang');
});
