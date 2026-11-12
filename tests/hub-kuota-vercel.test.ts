import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {isMeaningfulTag} from '../src/lib/quality';

function semuaBerkas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? semuaBerkas(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test('tidak ada revalidatePath yang membatalkan seluruh pohon halaman', () => {
  // 3 Nov 2026: revalidatePath('/', 'layout') dipanggil tiap putaran → ISR Writes Vercel
  // 203K/200K (kuota terlampaui) dan Fluid Active CPU 92%. Ini penyebabnya.
  for (const f of semuaBerkas('src')) {
    const isi = readFileSync(f, 'utf8');
    assert.ok(!/revalidatePath\(\s*'\/'\s*,\s*'layout'\s*\)/.test(isi),
      `${f} masih memakai revalidatePath('/', 'layout') — akan meledakkan ISR Writes`);
  }
});

test('putaran otomatis hanya menyegarkan beranda + sitemap', () => {
  const isi = readFileSync('src/server/hub/domain/auto-editor.ts', 'utf8');
  assert.match(isi, /revalidatePath\('\/'\)/);
  assert.match(isi, /revalidatePath\('\/sitemap\.xml'\)/);
  assert.match(isi, /revalidatePath\('\/sitemap-news\.xml'\)/);
});

test('kata umum yang terbukti jadi URL 404 tidak lagi menjadi halaman topik', () => {
  // Daftar ini diambil langsung dari Search Console → Tidak ditemukan (404), 3–7 Nov 2026.
  for (const t of ['ritel', 'curamnor', 'kontrakan', 'tangkap', 'serang', 'motor', 'ekspresi']) {
    assert.equal(isMeaningfulTag(t), false, `"${t}" masih lolos jadi halaman topik`);
  }
  // Kata yang benar-benar menunjuk peristiwa tetap lolos.
  for (const t of ['gempa lombok', 'pon 2028', 'sekolah rakyat']) {
    assert.equal(isMeaningfulTag(t), true, `"${t}" tidak boleh ikut tertolak`);
  }
});

const tanpaKomentar = (f: string) => readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

test('data terstruktur gambar memuat creator + copyrightNotice, tanpa mengarang lisensi', () => {
  const isi = tanpaKomentar('src/app/(public)/berita/[slug]/page.tsx');
  assert.match(isi, /creator: \{ '@type': 'Organization'/);
  assert.match(isi, /copyrightNotice: `© /);
  // Kita tidak memegang lisensi gambar siapa pun — jangan mengarang alamat lisensi.
  assert.ok(!/acquireLicensePage/.test(isi), 'jangan mengisi acquireLicensePage tanpa dasar');
  assert.ok(!/license:/.test(isi), 'jangan mengisi license tanpa dasar');
});
