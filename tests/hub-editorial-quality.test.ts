import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanSummary, keyPointsFor} from '../src/server/hub/domain/auto-editor';

test('kalimat "Baca juga" dibuang dari ringkasan', () => {
  const raw = 'Pemerintah Provinsi NTB membuka pendaftaran beasiswa bagi pelajar berprestasi tahun ini. Kuota tahap pertama sebanyak 500 penerima. Baca juga: Gubernur tinjau lokasi banjir di Lombok Barat';
  const out = cleanSummary(raw);
  assert.ok(!/baca juga/i.test(out), out);
  assert.ok(out.includes('500 penerima'));
});

test('ringkasan yang menggantung dipotong di batas kalimat, bukan di tengah kata', () => {
  const raw = 'Dinas Pendidikan NTB menyiapkan anggaran beasiswa untuk pelajar dan mahasiswa berprestasi pada tahun anggaran berikutnya yang akan dibahas bersama dewan';
  const out = cleanSummary(raw);
  assert.ok(!out.endsWith('dewan'), out);
  assert.ok(out.endsWith('…'), 'kutipan terpotong ditandai, bukan menggantung');
});

test('poin penting mengikuti judul, bukan sekadar tiga kalimat pertama', () => {
  const title = 'Beasiswa NTB dibuka untuk 500 pelajar';
  const snippet = 'Kegiatan pameran kuliner digelar di Mataram akhir pekan lalu dan dihadiri puluhan pelaku usaha. Beasiswa NTB dibuka bagi 500 pelajar dengan pendaftaran daring. Peserta wajib melampirkan rapor semester terakhir saat mendaftar.';
  const points = keyPointsFor(title, snippet);
  assert.ok(points.length >= 1);
  assert.match(points[0], /Beasiswa/i, `poin pertama harus relevan dengan judul, dapat: ${points[0]}`);
});

test('kalimat sampah tidak boleh jadi poin penting', () => {
  const points = keyPointsFor('Harga cabai naik di pasar Mataram', 'ADVERTISEMENT SCROLL TO RESUME CONTENT ini adalah pengumuman yang tidak penting untuk pembaca portal. Harga cabai di pasar Mataram naik karena pasokan berkurang. ');
  assert.ok(points.every(p => !/SCROLL TO RESUME|ADVERTISEMENT/i.test(p)));
});
