#!/usr/bin/env node
/**
 * Penjaga ISR: build DIBATALKAN bila halaman publik jatuh ke mode dinamis (ƒ).
 *
 * Kenapa perlu: `revalidate = 3600` pernah tertulis rapi di semua halaman tetapi tidak pernah
 * berjalan, karena @supabase/supabase-js memanggil fetch di dalam node_modules sehingga Next.js
 * tidak bisa melihat ketergantungan datanya. Tidak ada alat lain yang menangkapnya — `tsc` lolos,
 * tes lolos, `next build` sukses. Yang membocorkannya hanya tabel output build ini.
 *
 * Pemakaian:  node scripts/check-isr.mjs build.log
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'build.log';
let log = '';
try { log = readFileSync(file, 'utf8'); } catch {
  console.error(`Tidak bisa membaca ${file}. Jalankan: npm run build 2>&1 | tee ${file}`);
  process.exit(2);
}

/** Route publik yang WAJIB static/ISR (○ = static, ● = ISR). */
const MUST_BE_STATIC = [/^\/berita\/\[/, /^\/kategori\/\[/, /^\/wilayah\/\[/, /^\/topik\/\[/, /^\/hiburan$/, /^\/$/];

const rows = log.split('\n')
  .map((line) => line.match(/^[├└┌│\s]*([○●ƒλ])\s+(\S+)/))
  .filter(Boolean)
  .map((m) => ({ symbol: m[1], route: m[2] }));

if (!rows.length) {
  console.error('Tabel route tidak ditemukan di log build. Pastikan log berasal dari `next build`.');
  process.exit(2);
}

const offenders = rows.filter((r) => r.symbol === 'ƒ' && MUST_BE_STATIC.some((re) => re.test(r.route)));

if (offenders.length) {
  console.error('\n❌ ISR MATI pada halaman publik berikut:');
  for (const r of offenders) console.error(`   ƒ ${r.route}`);
  console.error('\nArtinya setiap kunjungan dan setiap crawl Googlebot menembak database.');
  console.error('Biasanya karena: (a) generateStaticParams tidak ada, atau');
  console.error('(b) data dibaca lewat klien yang menyembunyikan fetch dari compiler Next.\n');
  process.exit(1);
}

const stat = rows.filter((r) => MUST_BE_STATIC.some((re) => re.test(r.route)));
console.log(`✅ ISR aktif pada ${stat.length} route publik: ${stat.map((r) => r.route).join(', ')}`);
