import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

test('halaman /pemda dan /pemda/[id] ada dan memakai ISR', () => {
  const indeks = readFileSync('src/app/(public)/pemda/page.tsx', 'utf8');
  const detail = readFileSync('src/app/(public)/pemda/[id]/page.tsx', 'utf8');
  assert.match(indeks, /export const revalidate = 300/, 'indeks harus ISR 300 detik');
  assert.match(detail, /export const revalidate = 300/);
  assert.match(detail, /export const dynamicParams = true/);
  // Tanpa generateStaticParams halaman jatuh ke dinamis (ƒ) dan ISR tidak berjalan.
  assert.match(detail, /export async function generateStaticParams/);
  assert.match(detail, /notFound\(\)/, 'id tak dikenal harus 404, bukan halaman kosong');
});

test('halaman pemda tipis tidak diindeks (pola sama dengan /topik/[tag])', () => {
  const detail = readFileSync('src/app/(public)/pemda/[id]/page.tsx', 'utf8');
  assert.match(detail, /items\.length < 3 \? \{ index: false, follow: true \}/);
});

test('halaman pemda punya JSON-LD + canonical', () => {
  const indeks = readFileSync('src/app/(public)/pemda/page.tsx', 'utf8');
  const detail = readFileSync('src/app/(public)/pemda/[id]/page.tsx', 'utf8');
  assert.match(indeks, /CollectionPage/);
  assert.match(detail, /BreadcrumbList/);
  assert.match(detail, /canonical: `\/pemda\/\$\{id\}`/);
});

test('query pemda tidak mengarang: jumlah dihitung dari baris yang ada', () => {
  const q = readFileSync('src/lib/queries.ts', 'utf8');
  assert.match(q, /from\('pemda'\)/);
  assert.match(q, /from\('artikel_pemda'\)/);
  assert.match(q, /getPemdaArticles/, 'daftar artikel diambil lewat relasi artikel_pemda');
  assert.ok(!/Math\.random|dummy|contoh berita/i.test(q));
});

test('penjaga ISR mengawal /pemda/[id]', () => {
  const isr = readFileSync('scripts/check-isr.mjs', 'utf8');
  assert.match(isr, /\^\\\/pemda\\\/\\\[/);
});

test('footer memberi jalan masuk ke halaman pemda', () => {
  const f = readFileSync('src/components/Footer.tsx', 'utf8');
  assert.match(f, /'\/pemda'/);
  assert.ok(existsSync('src/app/(public)/pemda/page.tsx'));
});
