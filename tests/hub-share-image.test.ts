import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {largeImage, ukuranGambar, layakKartuBesar, imgSrc, UKURAN_TAMPIL} from '../src/lib/image-variant';

/**
 * Gejala nyata: dua postingan Facebook dari portal yang sama tampil berbeda —
 * satu kartu kecil (gambar mungil di kiri), satu kartu lebar dengan gambar besar.
 * Sebabnya bukan isi berita, tapi ukuran gambar yang diberikan CDN sumber:
 *   ?w=360  → 360×203  → Facebook memilih kartu KECIL
 *   ?w=1200 → 1200×675 → Facebook memilih kartu BESAR
 */

test('URL gambar kecil dinaikkan ke varian besar', () => {
  const asli = 'https://akcdn.detik.net.id/visual/2026/11/02/thumbnail-video-1793601541033_169.jpeg?w=360&q=90';
  const hasil = largeImage(asli);
  assert.equal(hasil.dinaikkan, true);
  assert.match(hasil.url, /w=1200/);
  assert.match(hasil.url, /q=90/, 'parameter lain tidak diubah');
  assert.equal(hasil.faktor, 1200 / 360);
});

test('gambar yang sudah besar tidak diperkecil', () => {
  const asli = 'https://cdn.contoh.id/foto.jpg?w=1600';
  const hasil = largeImage(asli);
  assert.equal(hasil.dinaikkan, false);
  assert.equal(hasil.url, asli);
});

test('URL tanpa parameter ukuran dibiarkan apa adanya', () => {
  const asli = 'https://cdn.contoh.id/foto.jpg';
  assert.equal(largeImage(asli).url, asli);
  assert.equal(largeImage(asli).dinaikkan, false);
});

test('nama parameter lain juga dikenali (width, maxwidth)', () => {
  assert.match(largeImage('https://cdn.contoh.id/a.jpg?width=300').url, /width=1200/);
  assert.match(largeImage('https://cdn.contoh.id/a.jpg?maxwidth=200').url, /maxwidth=1200/);
});

test('URL tidak aman ditolak, tidak diubah', () => {
  assert.equal(largeImage('http://cdn.contoh.id/a.jpg?w=360').url, 'http://cdn.contoh.id/a.jpg?w=360', 'http biasa tidak disentuh');
  assert.equal(largeImage('javascript:alert(1)').url, 'javascript:alert(1)');
  assert.equal(largeImage('').url, '');
  assert.equal(largeImage(null).url, '');
});

test('ukuran yang dideklarasikan ikut diskalakan — kalau tidak, Facebook tetap menganggapnya kecil', () => {
  const hasil = ukuranGambar('https://cdn.contoh.id/a.jpg?w=360', 360, 203);
  assert.match(hasil.url, /w=1200/);
  assert.equal(hasil.width, 1200);
  assert.equal(hasil.height, 677, '203 × (1200/360) dibulatkan');
  assert.ok(layakKartuBesar(hasil.width, hasil.height), 'sekarang layak kartu besar');
});

test('tanpa data lebar/tinggi, URL tetap dinaikkan dan angka tidak dikarang', () => {
  const hasil = ukuranGambar('https://cdn.contoh.id/a.jpg?w=360', null, null);
  assert.match(hasil.url, /w=1200/);
  assert.equal(hasil.width, undefined);
  assert.equal(hasil.height, undefined);
});

test('ambang kartu besar mengikuti rekomendasi Meta (minimal 600×315)', () => {
  assert.equal(layakKartuBesar(1200, 630), true);
  assert.equal(layakKartuBesar(600, 315), true);
  assert.equal(layakKartuBesar(360, 203), false);
  assert.equal(layakKartuBesar(null, null), false);
});

test('setiap tempat di portal memakai ukuran yang sesuai, dan tidak pernah memperkecil', () => {
  // hero & artikel butuh 1200, kartu 800, baris kecil 480
  assert.match(imgSrc('https://cdn.contoh.id/a.jpg?w=360', UKURAN_TAMPIL.hero), /w=1200/);
  assert.match(imgSrc('https://cdn.contoh.id/a.jpg?w=360', UKURAN_TAMPIL.kartu), /w=800/);
  assert.match(imgSrc('https://cdn.contoh.id/a.jpg?w=360', UKURAN_TAMPIL.baris), /w=480/);
  // gambar yang sudah besar tidak diturunkan walau target lebih kecil
  assert.match(imgSrc('https://cdn.contoh.id/a.jpg?w=1200', UKURAN_TAMPIL.baris), /w=1200/);
});

test('komponen portal memakai imgSrc, bukan image_url mentah', () => {
  const berkas = [
    ['src/components/HeroCard.tsx', 'hero'],
    ['src/components/HeroCarousel.tsx', 'hero'],
    ['src/components/NewsCard.tsx', 'kartu'],
    ['src/components/RowCard.tsx', 'kartu'],
    ['src/components/FeedRow.tsx', 'baris'],
    ['src/app/(public)/berita/[slug]/page.tsx', 'hero'],
  ] as const;
  for (const [jalur, ukuran] of berkas) {
    const isi = readFileSync(jalur, 'utf8');
    assert.ok(isi.includes('imgSrc('), `${jalur} harus memakai imgSrc`);
    assert.ok(isi.includes(`UKURAN_TAMPIL.${ukuran}`), `${jalur} harus memakai ukuran ${ukuran}`);
    assert.ok(!/<img[^>]*src=\{a\.image_url\}/.test(isi), `${jalur} masih memakai image_url mentah`);
  }
});

test("'use client' tetap baris pertama setelah impor ditambahkan", () => {
  const isi = readFileSync('src/components/HeroCarousel.tsx', 'utf8');
  assert.equal(isi.split('\n')[0].trim(), "'use client';", 'direktif client harus paling atas');
});
