import test from 'node:test';
import assert from 'node:assert/strict';
import {siapkanTerbit} from '../src/lib/pemda/terbitkan';

const draf = {
  judul: 'APBD KSB Tahun Anggaran 2027 Resmi Ditetapkan Menjadi Perda',
  ringkasan: 'Rancangan Peraturan Daerah tentang APBD Kabupaten Sumbawa Barat Tahun Anggaran 2027 resmi ditetapkan menjadi Peraturan Daerah dalam Rapat Paripurna DPRD Kabupaten Sumbawa Barat.',
  sumber_url: 'https://ppid.sumbawabaratkab.go.id/en/article/apbd-ksb-tahun-anggaran-2027',
  sumber_nama: 'PPID Sumbawa Barat',
  tanggal_sumber: '2026-11-09',
  gambar_url: 'https://ppid.sumbawabaratkab.go.id/uploads/pppk.jpg',
};

/** Regresi: panel mengirim {action:'setuju', id} tanpa judul. */
test('terbit: tanpa judul suntingan, judul DRAF dipakai — bukan "undefined"', () => {
  const hasil = siapkanTerbit(draf, undefined);
  assert.ok(hasil.ok); if (!hasil.ok) return;
  assert.equal(hasil.nilai.judul, draf.judul);
  assert.ok(!/undefined/i.test(hasil.nilai.slug), `slug tidak boleh mengandung "undefined": ${hasil.nilai.slug}`);
  assert.match(hasil.nilai.slug, /^apbd-ksb-tahun-anggaran-2027-resmi-ditetapkan-menjadi-perda-pemda-[0-9a-f]{12}$/);
});

test('terbit: judul suntingan yang kosong/null juga jatuh ke judul draf', () => {
  for (const suntingan of [undefined, null, '', '   ', 'undefined', 'null']) {
    const hasil = siapkanTerbit(draf, suntingan);
    assert.ok(hasil.ok, `suntingan ${JSON.stringify(suntingan)} harus jatuh ke judul draf`);
    if (!hasil.ok) continue;
    assert.ok(!/undefined|null/i.test(hasil.nilai.slug), `suntingan ${JSON.stringify(suntingan)} menghasilkan slug rusak`);
  }
});

test('terbit: judul dari draf yang rusak tetap ditolak, tidak diterbitkan', () => {
  const rusak = siapkanTerbit({...draf, judul: 'undefined'}, undefined);
  assert.equal(rusak.ok, false);
  const pendek = siapkanTerbit({...draf, judul: 'APBD'}, undefined);
  assert.equal(pendek.ok, false);
});

test('terbit: tanggal sumber dipakai, tidak dikarang; atribusi tidak terpotong', () => {
  const hasil = siapkanTerbit(draf, undefined);
  assert.ok(hasil.ok); if (!hasil.ok) return;
  assert.equal(hasil.nilai.terbit, '2026-11-09T00:00:00.000Z');
  // Atribusi + tautan asli harus selalu ikut, walau ringkasan panjang.
  assert.match(hasil.nilai.ringkasan, /Sumber: PPID Sumbawa Barat/);
  assert.match(hasil.nilai.ringkasan, /ppid\.sumbawabaratkab\.go\.id/);
  assert.ok(hasil.nilai.ringkasan.length <= 1000);

  const panjang = siapkanTerbit({...draf, ringkasan: 'a'.repeat(900)}, undefined);
  assert.ok(panjang.ok); if (!panjang.ok) return;
  assert.match(panjang.nilai.ringkasan, /Sumber: PPID Sumbawa Barat/, 'atribusi tidak boleh hilang karena ringkasan panjang');

  // Tanpa tanggal sumber → waktu persetujuan, bukan tanggal karangan.
  const tanpa = siapkanTerbit({...draf, tanggal_sumber: null}, undefined, Date.parse('2026-11-12T02:00:00Z'));
  assert.ok(tanpa.ok); if (!tanpa.ok) return;
  assert.equal(tanpa.nilai.terbit, '2026-11-12T02:00:00.000Z');
});

test('terbit: wilayah huruf kecil sesuai data lama, dan pemda terdeteksi', () => {
  const hasil = siapkanTerbit(draf, undefined);
  assert.ok(hasil.ok); if (!hasil.ok) return;
  assert.equal(hasil.nilai.wilayah, 'sumbawa-barat', 'region harus slug huruf kecil seperti baris lama (ntb, mataram)');
  assert.ok(hasil.nilai.pemda.includes('sumbawa-barat'), `pemda harus terdeteksi, dapat: ${hasil.nilai.pemda}`);

  const umum = siapkanTerbit({...draf, judul: 'Pemerintah provinsi menggelar rapat koordinasi', ringkasan: 'Rapat koordinasi membahas program prioritas daerah tahun depan bersama seluruh perangkat.'}, undefined);
  assert.ok(umum.ok); if (!umum.ok) return;
  assert.equal(umum.nilai.wilayah, 'ntb', 'tanpa daerah jelas, jatuh ke ntb — bukan string kosong');
});
