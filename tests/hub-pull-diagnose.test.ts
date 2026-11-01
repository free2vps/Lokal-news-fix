import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {diagnosePull} from '../src/server/hub/domain/pull-diagnose';

const SRC = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = Date.parse('2026-10-30T10:00:00Z');

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  const db = createClient({url: 'file:' + path.join(dir, 'diag.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute({
    sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,is_active,discovered_type,feed_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,'rss',?,?,?)",
    args: [SRC, 'media-ntb', 'Provinsi', 'NTB', 'https://a.example.org', 'https://a.example.org', 'a.example.org', 'rss', 'permission_confirmed', 'https://a.example.org/rss', '2026-10-30', '2026-10-30'],
  });
  await db.execute({
    sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_published_at,first_seen_at,last_seen_at,version,review_state) VALUES(?,?,?,?,?,?,?,?,?,1,'pending_review')",
    args: ['i1', SRC, 'guid:g-1', 'https://a.example.org/1', 'https://a.example.org/1', 'Sudah ada', new Date(NOW - 3600000).toISOString(), '2026-10-30', '2026-10-30'],
  });
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return {db};
}

const item = (n: number, over: Partial<{title: string; normalized: string | null; externalId: string | null; published: string | null}> = {}) => ({
  title: over.title ?? `Judul ${n}`, link: `https://a.example.org/${n}`,
  normalized: over.normalized === undefined ? `https://a.example.org/${n}` : over.normalized,
  urlError: null, dateRaw: 'Fri, 30 Oct 2026 09:00:00 +0800', published: over.published === undefined ? new Date(NOW - 3600000).toISOString() : over.published,
  externalId: over.externalId === undefined ? `g-${n}` : over.externalId,
});

test('diagnosa membedakan duplikat URL, duplikat identitas, tidak valid, dan siap', async () => {
  const {db} = await fixture();
  const res = await diagnosePull(db, {now: NOW, peek: async () => [
    item(1),                                                  // duplikat URL (sudah ada di DB)
    item(2, {normalized: 'https://a.example.org/2', externalId: 'g-1'}), // duplikat identitas
    item(3, {normalized: null}),                              // URL tidak valid
    item(4, {title: ''}),                                     // judul kosong
    item(9, {externalId: null}),                              // siap
  ]});
  assert.equal(res.sources.length, 1);
  const s = res.sources[0];
  assert.equal(s.ok, true);
  assert.equal(s.feedItems, 5);
  assert.equal(s.counts.duplikat_url, 1);
  assert.equal(s.counts.duplikat_identitas, 1);
  assert.equal(s.counts.url_invalid, 1);
  assert.equal(s.counts.judul_kosong, 1);
  assert.equal(s.counts.siap, 1);
  assert.equal(res.totals.siap, 1);
  assert.match(res.verdict, /1 berita baru/);
  assert.ok(s.samples.length === 3);
  await db.close();
});

test('semua duplikat → verdict menjelaskan 0 bukan kerusakan', async () => {
  const {db} = await fixture();
  const res = await diagnosePull(db, {now: NOW, peek: async () => [item(1), item(1)]});
  assert.equal(res.totals.siap, 0);
  assert.equal(res.totals.duplikat, 2);
  assert.match(res.verdict, /sudah ada di database/);
  await db.close();
});

test('feed gagal dibaca dilaporkan sebagai kode, bukan crash', async () => {
  const {db} = await fixture();
  const res = await diagnosePull(db, {now: NOW, peek: async () => { throw Error('HTTP_404'); }});
  assert.equal(res.sources[0].ok, false);
  assert.equal(res.sources[0].error, 'HTTP_404');
  assert.match(res.verdict, /gagal dibaca/);
  await db.close();
});

test('diagnosa tidak menulis apa pun ke database', async () => {
  const {db} = await fixture();
  const before = await db.execute('SELECT count(*) n FROM hub_items');
  await diagnosePull(db, {now: NOW, peek: async () => [item(7)]});
  const after = await db.execute('SELECT count(*) n FROM hub_items');
  assert.equal(Number(after.rows[0].n), Number(before.rows[0].n));
  // Tabel log tidak pernah dibuat oleh diagnosa; kalau ada, isinya harus tetap 0.
  const logs = await db.execute("SELECT count(*) n FROM hub_logs_v3").catch(() => null);
  assert.equal(logs === null ? 0 : Number(logs.rows[0].n), 0);
  await db.close();
});
