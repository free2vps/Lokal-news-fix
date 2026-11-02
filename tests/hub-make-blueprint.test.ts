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

test('blueprint Facebook: 4 langkah, memakai token, dan mengakui hasil kirim', () => {
  const isi = JSON.parse(readFileSync(`${DIR}/skenario-facebook-hemat-kuota.blueprint.json`, 'utf8'));
  assert.equal(isi.flow.length, 4);
  const modul = isi.flow.map((m: { module: string }) => m.module);
  assert.ok(modul.includes('http:ActionSendData'));
  assert.ok(modul.includes('facebook-pages:createPost'), 'harus ada modul Facebook');
  const teks = JSON.stringify(isi);
  assert.ok(teks.includes('action=pull'), 'harus menarik dari antrean');
  assert.ok(teks.includes('action=ack'), 'harus melaporkan hasil kirim');
  assert.ok(teks.includes('deliveryKey'), 'ack wajib membawa deliveryKey');
  assert.ok(teks.includes('GANTI_TOKEN_SOSIAL'), 'token masih placeholder — harus diganti pengguna');
});

test('blueprint Facebook hemat kuota: maksimal 2 berita per putaran', () => {
  const isi = JSON.parse(readFileSync(`${DIR}/skenario-facebook-hemat-kuota.blueprint.json`, 'utf8'));
  const tarik = isi.flow.find((m: any) => String(m.parameters?.url || '').includes('action=pull'));
  assert.ok(String(tarik.parameters.url).includes('max=2'), 'max=2 agar muat kuota gratis 1.000/bulan');
  assert.equal(isi.metadata.scenario.schedule.interval, 180, 'jadwal 3 jam = 180 menit');
});
