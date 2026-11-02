import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { encryptSecret } from '../src/server/hub/security/encryption';
import { classifyWithAi, KATEGORI } from '../src/server/hub/domain/ai-category';

// Format wajib: base64 dari tepat 32 byte.
const MASTER = Buffer.alloc(32, 7).toString('base64');
function db() {
  const dir = mkdtempSync(join(tmpdir(), 'hubcat-'));
  return createClient({ url: 'file:' + join(dir, 't.db') });
}
async function siapkan(c: ReturnType<typeof db>, opts: { allowPublic?: boolean; key?: boolean } = {}) {
  await c.execute(`CREATE TABLE hub_ai_policy_v2 (id TEXT PRIMARY KEY, allow_public INTEGER, groq_free INTEGER)`);
  await c.execute({ sql: "INSERT INTO hub_ai_policy_v2 VALUES('owner',?,0)", args: [opts.allowPublic === false ? 0 : 1] });
  await c.execute(`CREATE TABLE hub_ai_provider_settings (provider TEXT PRIMARY KEY, model TEXT, key_ciphertext TEXT, updated_at TEXT)`);
  if (opts.key !== false) {
    await c.execute({ sql: "INSERT INTO hub_ai_provider_settings VALUES('openrouter','meta/llama:free',?,?)",
      args: [encryptSecret('kunci-palsu-untuk-uji', 'openrouter', MASTER), new Date().toISOString()] });
  }
}
function balasan(kategori: string) {
  return (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ category: kategori }) } }] }), { status: 200 })) as unknown as typeof fetch;
}

test('AI memilih kategori yang sah', async () => {
  const c = db(); await siapkan(c);
  const out = await classifyWithAi(c, { title: 'Bupati Bima buka job fair 1.300 lowongan', summary: 'Pemkab menggelar bursa kerja.' },
    { master: MASTER, fetcher: balasan('Lowongan & CPNS') });
  assert.equal(out?.category, 'Lowongan & CPNS');
  assert.equal(out?.provider, 'openrouter');
});

test('kategori karangan AI DIBUANG, bukan dipaksakan', async () => {
  const c = db(); await siapkan(c);
  for (const ngawur of ['Berita Seru', 'Kategori Baru', '']) {
    const out = await classifyWithAi(c, { title: 'Judul ' + ngawur }, { master: MASTER, fetcher: balasan(ngawur) });
    assert.equal(out, null, `"${ngawur}" harus ditolak`);
  }
});

test('jawaban teks biasa (bukan JSON) tetap dikenali', async () => {
  const c = db(); await siapkan(c);
  const fetcher = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Olahraga' } }] }), { status: 200 })) as unknown as typeof fetch;
  const out = await classifyWithAi(c, { title: 'Persib menang' }, { master: MASTER, fetcher });
  assert.equal(out?.category, 'Olahraga');
});

test('hasil kedua diambil dari cache, provider tidak dipanggil lagi', async () => {
  const c = db(); await siapkan(c);
  let panggilan = 0;
  const fetcher = (async () => { panggilan++; return new Response(JSON.stringify({ choices: [{ message: { content: '{"category":"Ekonomi"}' } }] }), { status: 200 }); }) as unknown as typeof fetch;
  await classifyWithAi(c, { title: 'Harga cabai naik' }, { master: MASTER, fetcher });
  const kedua = await classifyWithAi(c, { title: 'Harga cabai naik' }, { master: MASTER, fetcher });
  assert.equal(kedua?.category, 'Ekonomi');
  assert.equal(kedua?.fromCache, true);
  assert.equal(panggilan, 1, 'provider hanya boleh dipanggil sekali');
});

test('tanpa izin pemilik, AI tidak dipanggil sama sekali', async () => {
  const c = db(); await siapkan(c, { allowPublic: false });
  let dipanggil = false;
  const fetcher = (async () => { dipanggil = true; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  const out = await classifyWithAi(c, { title: 'Apa saja' }, { master: MASTER, fetcher });
  assert.equal(out, null);
  assert.equal(dipanggil, false, 'tanpa izin, tidak boleh ada permintaan keluar');
});

test('tanpa kunci API, kembali null (pemanggil memakai aturan kata)', async () => {
  const c = db(); await siapkan(c, { key: false });
  const out = await classifyWithAi(c, { title: 'Apa saja' }, { master: MASTER, fetcher: balasan('Politik') });
  assert.equal(out, null);
});

test('semua kategori yang ditawarkan ke AI ada di daftar portal', () => {
  const portal = ['Info Pemda','Peristiwa Daerah','Lowongan & CPNS','Event & Kebijakan Lokal','Politik','Ekonomi','Hukum & Kriminal','Pendidikan','Kesehatan','Olahraga','Lingkungan','Teknologi','Sosial & Budaya','Umum','Selebriti','Film & Musik','Gaya Hidup','Viral & Trending','Kuliner & Wisata'];
  assert.deepEqual([...KATEGORI].sort(), [...portal].sort());
});
