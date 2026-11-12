import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tag, susunHashtag, cariTren, kataKunciTren, barisTag} from '../src/lib/hashtag';

const berita = {
  judul: 'APBD KSB Tahun Anggaran 2027 Resmi Ditetapkan Menjadi Perda',
  ringkasan: 'Raperda tentang APBD Kabupaten Sumbawa Barat 2027 ditetapkan dalam Rapat Paripurna DPRD.',
  wilayah: 'sumbawa-barat', kategori: 'Info Pemda', tag: ['APBD', 'DPRD'],
};

test('hashtag berasal dari isi berita: wilayah lalu kategori', () => {
  const h = susunHashtag(berita, []);
  assert.deepEqual(h, ['#SumbawaBarat', '#InfoPemda', '#APBD']);
  assert.equal(barisTag(h), '#SumbawaBarat #InfoPemda #APBD');
});

test('tanda baca dan spasi dibuang: "Lowongan & CPNS" → "#LowonganCPNS"', () => {
  assert.equal(tag('Lowongan & CPNS'), '#LowonganCPNS');
  assert.equal(tag('Sumbawa Barat'), '#SumbawaBarat');
  assert.equal(tag(''), null);
  assert.equal(tag('a'), null, 'terlalu pendek tidak jadi tag');
});

test('TREN: dipakai hanya bila kata pentingnya benar-benar ada di berita', () => {
  const cocok = susunHashtag(berita, ['Rapat Paripurna', 'Konser Dangdut']);
  assert.ok(cocok.some(t => /Paripurna/i.test(t)), 'tren yang muncul di berita harus dipakai');
  assert.ok(!cocok.some(t => /Dangdut/i.test(t)), 'tren yang tidak nyambung TIDAK boleh ditempel');

  const tidakAda = susunHashtag(berita, ['Konser Dangdut', 'Banjir Jakarta']);
  assert.ok(!tidakAda.some(t => /Dangdut|Banjir/i.test(t)), 'tanpa kecocokan, tidak ada tag tren');
  assert.equal(tidakAda.length, 3, 'slot tetap terisi tag dari isi berita');
});

test('TREN: kata umum tidak boleh memicu kecocokan palsu', () => {
  // "di hari ini" hanya berisi kata umum → tidak boleh cocok dengan berita apa pun.
  assert.equal(kataKunciTren('di hari ini'), null);
  assert.equal(cariTren('pemerintah daerah hari ini mengumumkan', ['di hari ini']), null);
  // Kata pendek/umum diabaikan; yang dipakai kata terpanjang yang bermakna.
  assert.equal(kataKunciTren('Banjir di Jakarta'), 'jakarta');
  // Kecocokan harus kata utuh, bukan potongan: "bima" tidak boleh cocok di "bimbel".
  assert.equal(cariTren('siswa mengikuti bimbel', ['Bima']), null);
  assert.equal(cariTren('Wali Kota Bima hadir', ['Bima']), 'Bima');
});

test('maksimal 3 tag, tidak ada rangkap, dan aman tanpa data apa pun', () => {
  const banyak = susunHashtag({...berita, tag: ['APBD', 'DPRD', 'Perda', 'Rapat', 'KSB']}, ['Rapat Paripurna']);
  assert.ok(banyak.length <= 3, `maksimal 3, dapat ${banyak.length}`);
  assert.equal(new Set(banyak.map(t => t.toLowerCase())).size, banyak.length, 'tidak boleh rangkap');

  const kosong = susunHashtag({judul: 'apa pun'}, []);
  assert.deepEqual(kosong, [], 'tanpa wilayah/kategori/tag, hasilnya kosong — bukan karangan');
});

test('rute sosial menempelkan hashtag dan caption siap pakai, tanpa menulis ke database', () => {
  const r = readFileSync('src/app/api/hub/social/route.ts', 'utf8');
  assert.match(r, /susunHashtag\(/);
  assert.match(r, /barisTag\(hashtags\)/);
  assert.match(r, /caption:\[String\(i\.title\|\|''\)/);
  assert.match(r, /claimBatch\(db,\{[^}]*\}\);\s*\n\s*return reply\(await denganHashtag\(db,out\)\)/);
  // Gagal membaca tren tidak boleh membatalkan pengiriman.
  assert.match(r, /catch\{tren=\[\];\}/);
  // src/server/hub/* tidak disentuh: berkas domain sosial tidak memuat hashtag.
  const pull = readFileSync('src/server/hub/domain/social-pull.ts', 'utf8');
  assert.ok(!/hashtag/i.test(pull), 'social-pull.ts tidak diubah');
});
