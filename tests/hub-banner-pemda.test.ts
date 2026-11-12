import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const baca = (p: string) => readFileSync(p, 'utf8');
// Tes terhadap kode sumber harus membuang komentar dulu, kalau tidak dokumentasi
// yang menjelaskan larangan justru dianggap pelanggaran.
const tanpaKomentar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

test('tabel banner_pemda punya migrasi, indeks, dan RLS baca-saja', () => {
  const p = 'supabase/migrations/20261112_banner_pemda.sql';
  assert.ok(existsSync(p), 'migrasi banner_pemda belum ada');
  const sql = baca(p);
  assert.match(sql, /create table if not exists public\.banner_pemda/i);
  assert.match(sql, /gambar_url\s+text not null/i);
  assert.match(sql, /aktif\s+boolean not null default true/i);
  assert.match(sql, /create index if not exists banner_pemda_aktif_idx/i);
  assert.match(sql, /enable row level security/i);
  // Hanya ada policy SELECT: penulisan lewat service role di backend.
  assert.equal((sql.match(/create policy/gi) || []).length, 1);
  assert.match(sql, /for select/i);
});

test('komponen beranda berlabel "Pengumuman" dan tidak tampil bila kosong', () => {
  const c = tanpaKomentar(baca('src/components/BannerPemda.tsx'));
  assert.match(c, /if \(!banner\) return null/, 'banner kosong harus mengembalikan null (tanpa kotak kosong)');
  assert.match(c, /Pengumuman/, 'slot wajib berlabel Pengumuman — iklan tanpa label = iklan gelap');
  assert.match(c, /rel="sponsored nofollow noopener"/, 'tautan berbayar tidak boleh meneruskan sinyal SEO');
  assert.match(c, /loading="lazy"/);
  // Tidak boleh ada kunci rahasia di berkas komponen.
  assert.ok(!/SERVICE_ROLE|SUPABASE_SERVICE/i.test(c));
});

test('beranda memasang slot banner dari data, bukan teks tetap', () => {
  const page = tanpaKomentar(baca('src/app/(public)/page.tsx'));
  assert.match(page, /import BannerPemda from '@\/components\/BannerPemda'/);
  assert.match(page, /getBanner\(\)/, 'beranda harus mengambil banner dari query');
  assert.match(page, /<BannerPemda banner=\{banner\} \/>/);
  const q = tanpaKomentar(baca('src/lib/queries.ts'));
  assert.match(q, /export async function getBanner/);
  assert.match(q, /from\('banner_pemda'\)/);
  assert.match(q, /revalidate: 300/, 'banner mengikuti ISR 5 menit beranda');
  // Penyaringan masa tayang harus ada, kalau tidak banner kedaluwarsa tetap muncul.
  assert.match(q, /selesai < hariIni/);
});

test('API banner memakai autentikasi, izin tulis, dan hanya menerima https', () => {
  const r = tanpaKomentar(baca('src/app/api/hub/banner/route.ts'));
  assert.match(r, /authenticatedDb\(request\)/);
  assert.match(r, /if\(!writesAllowed\(\)\)/);
  assert.match(r, /invalidMutation\(request\)/);
  assert.match(r, /if\(u\.protocol!=='https:'\)/, 'gambar/tautan wajib https');
  assert.match(r, /banner_pemda/, 'harus menulis ke tabel banner_pemda');
  assert.match(r, /action==='delete'/);
  // Rahasia hanya di server: route ini tidak boleh mengirim kunci ke klien.
  assert.ok(!/return reply\(\{[^}]*apikey/i.test(r));
});

test('panel pemilik mengirim ke /api/hub/banner dengan penanda X-Hub-Request', () => {
  const p = tanpaKomentar(baca('src/components/hub/BannerPemdaPanel.tsx'));
  assert.match(p, /fetch\('\/api\/hub\/banner'/);
  assert.match(p, /'X-Hub-Request':'1'/);
  assert.match(p, /methods?:\s*'POST'|method:'POST'/);
  assert.match(p, /window\.confirm\('Hapus banner ini/);
  const mod = tanpaKomentar(baca('src/components/hub/HubModules.tsx'));
  assert.match(mod, /<BannerPemdaPanel\/>/, 'panel harus terpasang di tab Integrasi');
});
