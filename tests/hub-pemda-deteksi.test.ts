import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deteksiPemda, pemdaDari, PEMDA} from '../src/lib/pemda/deteksi';

test('lima kasus wajib dari brief §4.2 lulus', () => {
  // "Bima Arya" adalah Wali Kota Bogor — bukan wilayah Bima.
  assert.deepEqual(pemdaDari('Bima Arya Dorong Pemda Sumbar Rancang Pertumbuhan Ekonomi'), []);
  assert.deepEqual(pemdaDari('Pemkot Bima Gelar Operasi Pasar'), ['kota-bima']);
  // "Bima" telanjang ambigu (nama orang juga) — lebih baik kosong daripada salah tempel.
  assert.deepEqual(pemdaDari('Warga Bima mengeluh air bersih'), []);
  assert.deepEqual(pemdaDari('Jembatan Sumbawa Barat diresmikan', ''), ['sumbawa-barat']);
  assert.deepEqual(pemdaDari('Kabupaten Sumbawa panen raya', ''), ['sumbawa']);
});

test('Sumbawa tidak boleh tertangkap saat artikelnya tentang Sumbawa Barat', () => {
  assert.deepEqual(pemdaDari('Pemkab Sumbawa Barat resmikan jalan baru'), ['sumbawa-barat']);
  assert.deepEqual(pemdaDari('Taliwang gelar festival'), ['sumbawa-barat']);
  assert.deepEqual(pemdaDari('Pemda Sumbawa menata pasar'), ['sumbawa']);
});

test('nama orang yang memakai nama daerah tidak masuk', () => {
  assert.deepEqual(pemdaDari('Bima Sakti pimpin latihan timnas'), []);
  assert.deepEqual(pemdaDari('Komentar Bima Arya soal Pilkada'), []);
});

test('sebelas pemda dikenali dengan id yang sama seperti tabel pemda', () => {
  assert.equal(PEMDA.length, 11);
  assert.deepEqual(PEMDA.map(p => p.id), [
    'ntb-provinsi', 'lombok-barat', 'lombok-tengah', 'lombok-timur', 'lombok-utara',
    'mataram', 'sumbawa', 'sumbawa-barat', 'dompu', 'kabupaten-bima', 'kota-bima',
  ]);
  assert.deepEqual(pemdaDari('Pemprov NTB raih penghargaan'), ['ntb-provinsi']);
  assert.deepEqual(pemdaDari('Bupati Bima tinjau lokasi banjir'), ['kabupaten-bima']);
  assert.deepEqual(pemdaDari('Diskominfo Dompu gelar pelatihan'), ['dompu']);
  assert.deepEqual(pemdaDari('Pemkot Mataram tertibkan pedagang'), ['mataram']);
  assert.deepEqual(pemdaDari('Lotim tambah puskesmas'), ['lombok-timur']);
  assert.deepEqual(pemdaDari('Loteng siapkan anggaran'), ['lombok-tengah']);
  assert.deepEqual(pemdaDari('KLU buka pendaftaran'), ['lombok-utara']);
  assert.deepEqual(pemdaDari('Lobar bersihkan pantai'), ['lombok-barat']);
});

test('artikel bisa menyebut lebih dari satu pemda, subjek utama = yang pertama', () => {
  const h = deteksiPemda('Gubernur NTB bersama Bupati Bima tinjau lokasi banjir');
  assert.deepEqual(h.pemda, ['ntb-provinsi', 'kabupaten-bima']);
  assert.equal(h.utama, 'ntb-provinsi');
  assert.equal(h.rilis, true, 'kata Gubernur/Bupati = penanda rilis resmi');
});

test('penanda rilis dibedakan dari berita biasa', () => {
  assert.equal(deteksiPemda('Pemkot Bima gelar operasi pasar').rilis, true);
  assert.equal(deteksiPemda('Warga Lombok Timur mengeluh air keruh').rilis, false);
});

test('teks kosong tidak menghasilkan apa pun', () => {
  assert.deepEqual(deteksiPemda('', '').pemda, []);
  assert.equal(deteksiPemda('', '').utama, null);
});

test('gerbang pemda berjalan mode bayangan: default TIDAK menolak artikel', () => {
  const isi = readFileSync('src/lib/content-hub/mapping.ts', 'utf8');
  // Penolakan hanya boleh terjadi bila pemilik menyetel LOCALITY_GATE=block secara sadar.
  assert.match(isi, /LOCALITY_GATE === 'block'\) return null/, 'penolakan harus di balik setelan');
  const baris = isi.split('\n').filter(l => l.includes('LOCALITY_GATE'));
  assert.ok(baris.length >= 2, 'harus ada jalur bayangan + jalur blokir');
  assert.ok(/deteksiPemda\(title, summary\)/.test(isi), 'gerbang memakai deteksi ketat, bukan regions lama');
});

test('migrasi pemda memuat 11 baris dan status akses hasil ukur', () => {
  const sql = readFileSync('supabase/migrations/20261103_pemda.sql', 'utf8');
  const baris = sql.split('\n').filter(l => /^\s*\('[a-z-]+',/.test(l));
  assert.equal(baris.length, 11, 'harus tepat 11 pemda');
  assert.equal((sql.match(/'bisa'/g) || []).length >= 4, true, '4 pemda terukur bisa dibaca');
  assert.match(sql, /check \(status_akses in \('bisa','diblokir','mati','belum'\)\)/);
});
