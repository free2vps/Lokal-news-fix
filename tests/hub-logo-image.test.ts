import test from 'node:test';
import assert from 'node:assert/strict';
import {isLogoImage, imageFromHtml} from '../src/server/hub/domain/article-image';

test('logo Google News / gstatic ditolak, foto penerbit diterima', () => {
  // Gejala nyata 1 Nov 2026: berita Google News terbit dengan logo ini.
  assert.equal(isLogoImage('https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc=s0-w300'), true);
  assert.equal(isLogoImage('https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc'), true);
  assert.equal(isLogoImage('https://news.google.com/rss/articles/abc'), true);
  // Foto penerbit yang sah TIDAK boleh ikut tertolak (dulu "detik…/visual/" salah tertolak).
  assert.equal(isLogoImage('https://akcdn.detik.net.id/visual/2026/11/01/foto_169.jpeg'), false);
  assert.equal(isLogoImage('https://img.antaranews.com/cache/800x533/2026/11/01/abc.jpeg'), false);
  assert.equal(isLogoImage('https://cdn.beautyhaul.com/assets/uploads/thumbs/11-ab.webp'), false);
});

test('bila og:image adalah logo, foto asli di badan artikel yang dipakai', () => {
  const html = `<html><head><meta property="og:image" content="https://lh3.googleusercontent.com/logo=s0"></head>
    <body><article><img src="https://img.antaranews.com/real.jpg" alt="foto berita"></article></body></html>`;
  assert.equal(imageFromHtml(html, 'https://contoh.test/a', {title: 'Berita'}), 'https://img.antaranews.com/real.jpg');
});

test('bila hanya ada logo, hasilnya null — bukan logo', () => {
  const html = `<html><head><meta property="og:image" content="https://lh3.googleusercontent.com/logo=s0"></head><body><p>tanpa foto</p></body></html>`;
  assert.equal(imageFromHtml(html, 'https://contoh.test/a', {title: 'Berita'}), null);
});
