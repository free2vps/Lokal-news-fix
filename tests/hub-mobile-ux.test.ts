import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const baca = (f: string) => readFileSync(f, 'utf8');

test('menu utama punya sasaran sentuh minimal 44 px di ponsel', () => {
  // Rekomendasi Apple HIG / Material: minimum 44–48 px. Sebelumnya ~36 px.
  const h = baca('src/components/Header.tsx');
  assert.match(h, /const tab = 'flex min-h-\[44px\]/, 'tab menu harus min-h 44px');
  assert.ok(!/px-3 py-2 text-muted/.test(h), 'py-2 lama (36 px) tidak boleh kembali');
  assert.match(h, /Beranda<\/Link>/, 'tautan Beranda tetap ada');
});

test('baris topik trending juga bisa disentuh dengan nyaman', () => {
  const t = baca('src/components/TrendingNow.tsx');
  assert.match(t, /min-h-\[44px\]/);
});

test('gambar tidak menyebabkan halaman bergeser (CLS) dan tidak dimuat berlebihan', () => {
  // Semua gambar besar berada di dalam wadah beraspek tetap, jadi ruangnya sudah dipesan
  // sebelum gambar selesai dimuat. Ini alasan tidak dipasang width/height eksplisit.
  const hero = baca('src/components/HeroCard.tsx');
  const carousel = baca('src/components/HeroCarousel.tsx');
  const kartu = baca('src/components/NewsCard.tsx');
  assert.match(hero, /aspect-\[/, 'hero memakai wadah beraspek');
  assert.match(kartu, /aspect-\[16\/9\]/, 'kartu berita memakai wadah beraspek');
  assert.match(kartu, /loading="lazy"/, 'gambar di bawah lipatan harus lazy');
  assert.match(carousel, /fetchPriority=\{i === 0 \? 'high' : 'auto'\}/, 'gambar utama (korsel) diprioritaskan');
  assert.match(hero, /loading=\{size === 'lg' \? 'eager' : 'lazy'\}/, 'hero besar dimuat lebih awal, sisanya lazy');
});

test('gerak tidak dipaksakan bagi pengguna yang mematikan animasi', () => {
  const css = baca('src/app/globals.css');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.marquee \{ animation: none; \}/);
});

test('meta viewport tidak mematikan zoom (aksesibilitas)', () => {
  const layout = baca('src/app/(public)/layout.tsx');
  assert.ok(!/maximum-scale|user-scalable=no/.test(layout), 'menonaktifkan zoom melanggar aksesibilitas');
});
