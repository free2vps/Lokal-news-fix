import test from 'node:test';
import assert from 'node:assert/strict';
import { isSiteNameTitle, isJobPosting, isMeaningfulTag, meaningfulTags } from '../src/lib/quality';

test('B1: nama situs tidak diterima sebagai judul berita', () => {
  // gejala nyata di produksi
  assert.equal(isSiteNameTitle('Kementerian Komunikasi dan Digital - Komdigi', 'Komdigi'), true);
  assert.equal(isSiteNameTitle('Komdigi', 'Komdigi'), true);
  assert.equal(isSiteNameTitle('Portal Resmi Pemerintah Kota Bima', 'bimakota.go.id'), true);
  // judul berita sungguhan harus lolos
  assert.equal(isSiteNameTitle('Bupati Dompu dukung BPR NTB perluas layanan PPPK dan UMKM', 'Antara'), false);
  assert.equal(isSiteNameTitle('Mentan Amran: Indonesia kuat saat 33 negara siapkan pangan darurat', 'Antara'), false);
  assert.equal(isSiteNameTitle('Anak Muda Jembrana Ditantang Jangan Jadi Penonton', 'Nusa Bali'), false);
});

test('B3: PPPK saja bukan lowongan; pengumuman lowongan barulah lowongan', () => {
  assert.equal(isJobPosting('Bupati Dompu dukung BPR NTB perluas layanan PPPK dan UMKM'), false);
  assert.equal(isJobPosting('Pemkab Bima buka pendaftaran PPPK 2026'), true);
  assert.equal(isJobPosting('Lowongan Kerja PT Wanhe Garment Indonesia di Pemkab Kebumen'), true);
  assert.equal(isJobPosting('Bupati Bekasi Buka Job Fair Virtual, 45 Perusahaan Tawarkan 1.313 Lowongan'), true);
});

test('B4: kata umum tidak dijadikan halaman topik', () => {
  for (const junk of ['tahun', 'orang', 'jadi', 'atas', 'cara', '2026', 'pemkab', 'ruang']) {
    assert.equal(isMeaningfulTag(junk), false, `"${junk}" harus ditolak`);
  }
  for (const ok of ['drakor', 'bupati', 'jembrana', 'sumbawa', 'kpk']) {
    assert.equal(isMeaningfulTag(ok), true, `"${ok}" harus diterima`);
  }
  assert.deepEqual(meaningfulTags(['drakor', 'tahun', 'bupati', '2026']), ['drakor', 'bupati']);
});
