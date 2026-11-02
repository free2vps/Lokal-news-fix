import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'make';
const berkas = readdirSync(DIR).filter((f) => f.endsWith('.json'));

test('semua blueprint adalah JSON yang sah', () => {
  for (const f of berkas) {
    const isi = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
    assert.ok(Array.isArray(isi.flow) && isi.flow.length > 0, `${f} harus punya flow`);
  }
});

test('tidak ada blueprint yang menunjuk deployment mati', () => {
  // Alamat lama ini menjawab 302 (diproteksi Vercel) sehingga Make selalu gagal.
  for (const f of berkas) {
    const isi = readFileSync(`${DIR}/${f}`, 'utf8');
    assert.ok(!isi.includes('64ay9i2fr-free2vps'), `${f} masih menunjuk alamat lama yang sudah mati`);
  }
});

test('nama & versi modul Facebook harus persis seperti yang dipakai Make', () => {
  // Kesalahan nyata r43: 'facebook-pages:createPost' v1 ditolak Make
  // ("Module not found"). Yang benar versi 6, huruf besar.
  const isi = JSON.parse(readFileSync(`${DIR}/skenario-facebook-hemat-kuota.blueprint.json`, 'utf8'));
  const fb = isi.flow.find((m: any) => String(m.module).startsWith('facebook-pages'));
  assert.ok(fb, 'modul Facebook harus ada');
  assert.equal(fb.module, 'facebook-pages:CreatePost');
  assert.equal(fb.version, 6);
  // Field dikirim lewat mapper, bukan parameters (parameters hanya untuk setelan modul).
  assert.ok(fb.mapper.page_id !== undefined, 'page_id ada di mapper');
  assert.equal(fb.mapper.link, '{{2.articleUrl}}', 'tautan ke domain portal sendiri');
  assert.ok(fb.mapper.message.includes('{{2.title}}'));
  assert.equal(fb.parameters.__IMTCONN__, undefined, 'koneksi dipilih pengguna, jangan diisi');
});

test('struktur blueprint sah: field di mapper, iterator mengambil .data.items, tanpa kunci next', () => {
  const isi = JSON.parse(readFileSync(`${DIR}/skenario-facebook-hemat-kuota.blueprint.json`, 'utf8'));
  for (const m of isi.flow) {
    assert.equal((m as any).next, undefined, 'Make menyambung modul lewat urutan array, bukan "next"');
    if (m.module === 'http:ActionSendData') {
      assert.equal(m.version, 3);
      assert.ok(m.mapper.url, 'url harus di mapper');
      assert.equal((m.parameters as any).url, undefined, 'url TIDAK boleh di parameters');
    }
  }
  const it = isi.flow.find((m: any) => m.module === 'builtin:BasicFeeder');
  assert.ok(it, 'perlu iterator');
  assert.equal(it.version, 1);
  assert.equal(it.mapper.array, '{{1.data.items}}', 'HTTP mengembalikan {data:{items:[]}}');
  assert.equal((it.parameters as any).array, undefined);
});

test('blueprint Facebook: 4 langkah, memakai token, dan mengakui hasil kirim', () => {
  const isi = JSON.parse(readFileSync(`${DIR}/skenario-facebook-hemat-kuota.blueprint.json`, 'utf8'));
  assert.equal(isi.flow.length, 4);
  const modul = isi.flow.map((m: { module: string }) => m.module);
  assert.ok(modul.includes('http:ActionSendData'));
  assert.ok(modul.includes('facebook-pages:CreatePost'), 'harus ada modul Facebook');
  const teks = JSON.stringify(isi);
  assert.ok(teks.includes('action=pull'), 'harus menarik dari antrean');
  assert.ok(teks.includes('action=ack'), 'harus melaporkan hasil kirim');
  assert.ok(teks.includes('deliveryKey'), 'ack wajib membawa deliveryKey');
  assert.ok(teks.includes('GANTI_TOKEN_SOSIAL'), 'token masih placeholder — harus diganti pengguna');
});

test('blueprint Facebook hemat kuota: maksimal 2 berita per putaran', () => {
  const isi = JSON.parse(readFileSync(`${DIR}/skenario-facebook-hemat-kuota.blueprint.json`, 'utf8'));
  const tarik = isi.flow.find((m: any) => String(m.mapper?.url || '').includes('action=pull'));
  assert.ok(String(tarik.mapper.url).includes('max=2'), 'max=2 agar muat kuota gratis 1.000/bulan');
  assert.ok(String(tarik.mapper.url).includes('cap=16'), 'kuota harian ditulis eksplisit');
  assert.equal(isi.metadata.scenario.schedule.interval, 180, 'jadwal 3 jam = 180 menit');
});

test('enam kesalahan nyata pada blueprint buatan tangan tidak boleh kembali', () => {
  const isi = JSON.parse(readFileSync(`${DIR}/skenario-facebook-hemat-kuota.blueprint.json`, 'utf8'));
  const http = isi.flow.filter((m: any) => m.module === 'http:ActionSendData');
  assert.equal(http.length, 2, 'modul 1 (tarik) dan modul 4 (lapor)');
  for (const m of http) {
    const url = String(m.mapper.url || '');
    assert.ok(url.includes('/api/hub/social'), `modul ${m.id}: URL harus endpoint, bukan halaman depan`);
    assert.ok(/action=(pull|ack)/.test(url), `modul ${m.id}: aksi harus jelas`);
    const otorisasi = (m.mapper.headers || []).some((h: any) => String(h.name).toLowerCase() === 'authorization');
    assert.ok(otorisasi, `modul ${m.id}: tanpa header Authorization akan ditolak 401`);
    assert.equal(m.mapper.parseResponse, true, `modul ${m.id}: respons harus diurai`);
  }
  const ack = http.find((m: any) => String(m.mapper.url).includes('action=ack'));
  assert.equal(ack.mapper.method, 'post', 'lapor harus POST');
  assert.ok(String(ack.mapper.data).includes('deliveryKey'), 'ack wajib membawa deliveryKey');
  const fb = isi.flow.find((m: any) => String(m.module).startsWith('facebook-pages')) as any;
  assert.ok(fb.mapper.message && fb.mapper.message.length > 10, 'caption tidak boleh kosong');
  assert.ok(fb.mapper.link, 'tautan tidak boleh kosong');
});

test('jadwal GitHub tidak memakai menit 0 — awal jam paling sering dibuang GitHub', () => {
  const isi = readFileSync('.github/workflows/hub-tick.yml', 'utf8');
  const cron = isi.match(/cron:\s*'([^']+)'/)?.[1] || '';
  assert.ok(cron, 'harus ada cron');
  const menit = cron.split(' ')[0];
  assert.notEqual(menit, '0', 'menit 0 = puncak beban GitHub, run sering dibuang tanpa jejak');
  assert.match(menit, /^\d+$/, 'menit harus angka tunggal');
  // Jam 05-23 WITA = 21-23 dan 00-15 UTC
  assert.match(cron.split(' ')[1], /0-15,21-23/, 'jendela jam harus tetap 05:00-23:59 WITA');
});
