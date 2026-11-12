import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * BUG NYATA yang dijaga tes ini:
 * Make.com memanggil `GET /api/hub/social?action=pull` dengan bearer token.
 * Sebelumnya cabang bertoken hanya ada di handler POST, sehingga permintaan GET
 * jatuh ke pemeriksaan sesi dan dijawab
 *   401 "Silakan masuk sebagai administrator."
 * Make pun tidak pernah menerima satu berita pun.
 */

const dir = mkdtempSync(path.join(os.tmpdir(), 'social-route-'));
const dbfile = path.join(dir, 'r.db');

process.env.HUB_DATABASE_URL = 'file:' + dbfile;
process.env.HUB_ALLOW_LOCAL_DB = 'true';
process.env.HUB_WRITE_TARGET = 'both';
process.env.VERCEL_ENV = 'production';
process.env.HUB_PUBLIC_SITE_URL = 'https://situs-contoh.example';
delete process.env.HUB_BOOTSTRAP_EXPECTED_DATABASE;
delete process.env.HUB_BOOTSTRAP_ALLOW;

let siap: Promise<{route: any; token: string; db: any}> | null = null;
let kunciTertunda = '';

async function persiapan() {
const {createClient} = await import('@libsql/client');
const db = createClient({url: 'file:' + dbfile});
await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
const {prepareSocialSchema, issueSocialToken} = await import('../src/server/hub/domain/social-pull');

const now = Date.now();
const waktu = new Date(now - 30 * 60000).toISOString(); // 30 menit lalu — masih segar
const id = 'news:00000000-0000-0000-0000-000000000001';
const snapshot = JSON.stringify({id, sourceId: 's1', originalUrl: 'https://sumber.example/1', sourceTitle: 'Judul', sourceSnippet: 'Ringkas', sourcePublishedAt: waktu, editorialTitle: 'Berita segar untuk Facebook', editorialSummary: 'Ringkasan singkat berita.', editorialCategory: 'Daerah', version: 1});

await db.execute("INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES('s1','Media','Provinsi','NTB','https://sumber.example','https://sumber.example','sumber.example','rss','permission_confirmed','2026-11-01','2026-11-01')");
await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category,version,review_state,approved_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  args: [id, 's1', 'k1', 'https://sumber.example/1', 'https://sumber.example/1', 'Judul', 'Ringkas', waktu, waktu, waktu, 'Berita segar untuk Facebook', 'Ringkasan singkat berita.', 'Daerah', 1, 'approved', 1]});
await db.execute({sql: 'INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES(?,1,?,?,?)', args: [id, snapshot, waktu, 'owner']});
await db.execute({sql: "INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at) VALUES('o1','k1',?,1,?,'published',?)", args: [id, snapshot, waktu]});
await prepareSocialSchema(db);
await db.execute({sql: "INSERT INTO hub_social_queue_v2(delivery_key,item_id,item_version,status,created_at,updated_at) VALUES('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',?,1,'pending',?,?)", args: [id, waktu, waktu]});
const {token} = await issueSocialToken(db, 'make.com');

const route = await import('../src/app/api/hub/social/route');
return {route, token, db};
}

const siapkan = () => (siap ??= persiapan());

test('GET ?action=pull dengan bearer token diterima — bukan 401 "masuk sebagai administrator"', async () => {
  const {route, token} = await siapkan();
  const req = new Request('https://situs-contoh.example/api/hub/social?action=pull&max=2&cap=16', {
    method: 'GET', headers: {authorization: `Bearer ${token}`},
  });
  const res = await route.GET(req);
  assert.equal(res.status, 200, 'Make memakai GET; harus 200');
  const j: any = await res.json();
  assert.ok(Array.isArray(j.items), 'respons harus punya items');
  assert.equal(j.items.length, 1);
  assert.equal(j.items[0].title, 'Berita segar untuk Facebook');
  assert.match(String(j.items[0].articleUrl), /^https:\/\/situs-contoh\.example\/berita\//, 'tautan harus ke portal sendiri');
  kunciTertunda = j.items[0].deliveryKey;
  assert.equal(j.dailyPostCap, 16);
});

test('GET tanpa token tetap 401 — panel admin tetap dilindungi', async () => {
  const {route} = await siapkan();
  const res = await route.GET(new Request('https://situs-contoh.example/api/hub/social?action=pull'));
  assert.equal(res.status, 401);
});

test('GET dengan token salah ditolak dengan pesan token, bukan pesan sesi', async () => {
  const {route} = await siapkan();
  const res = await route.GET(new Request('https://situs-contoh.example/api/hub/social?action=pull', {
    headers: {authorization: 'Bearer 0000000000000000000000000000000000000000000000000000000000000000'},
  }));
  assert.equal(res.status, 401);
  const j: any = await res.json();
  assert.match(String(j.error), /Token tidak valid/, 'pesannya harus jelas soal token');
});

test('POST ?action=ack dengan bearer menandai item terkirim', async () => {
  const {route, token, db} = await siapkan();
  assert.match(kunciTertunda, /^[a-f0-9]{32}$/, 'kunci dari tes sebelumnya');
  const kunci = kunciTertunda;

  const ack = await route.POST(new Request('https://situs-contoh.example/api/hub/social?action=ack', {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({results: [{deliveryKey: kunci, ok: true}]}),
  }));
  assert.equal(ack.status, 200);
  const hasil: any = await ack.json();
  assert.equal(hasil.delivered, 1);
});

test('bersihkan', async () => {
  const {db} = await siapkan();
  await db.close();
  rmSync(dir, {recursive: true, force: true});
});
