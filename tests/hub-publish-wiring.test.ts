import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareAutoEditor, runAutoEditor, setAutoEditor, saveAutoConfig} from '../src/server/hub/domain/auto-editor';
import {prepareProfiles} from '../src/server/hub/domain/content-profile';
import {prepareValues} from '../src/server/hub/domain/editorial-value';
import {prepareSummarySchema} from '../src/server/hub/domain/ai-summary';
import {preparePublishSchema} from '../src/server/hub/domain/publish-policy';
import {prepareSocialSchema} from '../src/server/hub/domain/social-pull';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const SRC = 'aaaaaaaa-2222-2222-2222-222222222222';

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wire-'));
  const db = createClient({url: 'file:' + path.join(dir, 'w.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute({
    sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,is_active,discovered_type,feed_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,'rss',?,?,?)",
    args: [SRC, 'media-ntb', 'Provinsi', 'NTB', 'https://a.test', 'https://a.test', 'a.test', 'rss', 'permission_confirmed', 'https://a.test/rss', '2026-10-30', '2026-10-30'],
  });
  await db.execute({
    sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,version,review_state) VALUES(?,?,?,?,?,?,?,?,?,?,1,'pending_review')",
    args: ['i1', SRC, 'k1', 'https://a.test/1', 'https://a.test/1', 'Beasiswa pelajar NTB dibuka',
      'Pemerintah Provinsi NTB membuka pendaftaran beasiswa bagi pelajar berprestasi. Kuota tahap pertama 500 penerima. Pendaftaran ditutup akhir bulan.', new Date(NOW - 3600000).toISOString(), '2026-10-30', '2026-10-30'],
  });
  await prepareProfiles(db); await prepareValues(db); await prepareSummarySchema(db);
  await preparePublishSchema(db); await prepareSocialSchema(db); await prepareAutoEditor(db);
  await saveAutoConfig(db, {maxPerRun: 5, maxPerDay: 10, aiPerRun: 0}, 'owner', NOW);
  await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return {db};
}

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'HUB_WEBSITE_SUPABASE_URL', 'HUB_WEBSITE_SERVICE_ROLE_KEY'] as const;
function withEnv(values: Record<string, string>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
  return () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

test('tanpa kredensial: putaran gagal diterbitkan dan TIDAK ada permintaan jaringan', async () => {
  const restore = withEnv({});
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw Error('tidak boleh dipanggil'); }) as typeof fetch;
  const {db} = await fixture();
  try {
    const out = await runAutoEditor(db, {now: NOW, skipPull: true});
    assert.equal(out.published, 0);
    const publish = out.steps.find(s => s.step === 'publish')!;
    assert.equal(publish.ok, false);
    assert.match(String(publish.detail), /PUBLISH_TARGET_NOT_CONFIGURED/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; await db.close(); restore(); }
});

test('kredensial situs tersedia: redaktur otomatis BENAR-BENAR mengirim ke Supabase (bug lama)', async () => {
  const restore = withEnv({NEXT_PUBLIC_SUPABASE_URL: 'https://site.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'site-key'});
  const originalFetch = globalThis.fetch;
  const seen: {url: string; key: string | null; body: string}[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const headers = new Headers(init?.headers);
    seen.push({url: String(input), key: headers.get('apikey'), body: String(init?.body || '')});
    const rows = JSON.parse(String(init?.body || '[]')) as {source_url: string}[];
    return new Response(JSON.stringify(rows.map((r, i) => ({id: 'new-' + i, source_url: r.source_url}))), {status: 201});
  }) as typeof fetch;
  const {db} = await fixture();
  try {
    const out = await runAutoEditor(db, {now: NOW, skipPull: true});
    assert.equal(out.published, 1, 'satu artikel harus benar-benar terbit');
    assert.equal(seen.length, 1);
    assert.ok(seen[0].url.startsWith('https://site.supabase.co/rest/v1/articles'));
    assert.equal(seen[0].key, 'site-key');
    const publish = out.steps.find(s => s.step === 'publish')!;
    assert.equal(publish.ok, true);
    const sent = JSON.parse(seen[0].body) as {title: string; source_url: string; section: string}[];
    assert.equal(sent.length, 1);
    assert.match(sent[0].source_url, /https:\/\/a\.test\/1/);
    assert.ok(sent[0].title.length > 0);
    const outbox = await db.execute("SELECT status FROM hub_publish_outbox");
    assert.equal(String(outbox.rows[0].status), 'published');
  } finally { globalThis.fetch = originalFetch; await db.close(); restore(); }
});

test('variabel khusus Hub tetap diprioritaskan bila keduanya ada', async () => {
  const restore = withEnv({HUB_WEBSITE_SUPABASE_URL: 'https://hub-target.supabase.co', HUB_WEBSITE_SERVICE_ROLE_KEY: 'hub-key',
    NEXT_PUBLIC_SUPABASE_URL: 'https://site.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'site-key'});
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    urls.push(String(input));
    const rows = JSON.parse(String(init?.body || '[]')) as {source_url: string}[];
    return new Response(JSON.stringify(rows.map((r, i) => ({id: 'n' + i, source_url: r.source_url}))), {status: 201});
  }) as typeof fetch;
  const {db} = await fixture();
  try {
    await runAutoEditor(db, {now: NOW, skipPull: true});
    assert.ok(urls[0].startsWith('https://hub-target.supabase.co'));
  } finally { globalThis.fetch = originalFetch; await db.close(); restore(); }
});

test('artikel yang sebelumnya gagal dikirim DICOBA LAGI, tidak terkunci selamanya', async () => {
  const restore = withEnv({NEXT_PUBLIC_SUPABASE_URL: 'https://site.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'site-key'});
  const {db} = await fixture();
  try {
    // Putaran pertama: pengiriman gagal (mis. jaringan mati) → outbox berstatus 'failed'.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('no', {status: 500})) as typeof fetch;
    const first = await runAutoEditor(db, {now: NOW, skipPull: true});
    assert.equal(first.published, 0);
    const afterFail = await db.execute("SELECT status,count(*) n FROM hub_publish_outbox GROUP BY status");
    assert.equal(String(afterFail.rows[0].status), 'failed');

    // Putaran kedua dengan pengiriman sehat: baris 'failed' harus dicoba lagi.
    const sent: string[] = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const rows = JSON.parse(String(init?.body || '[]')) as {source_url: string}[];
      sent.push(...rows.map(r => r.source_url));
      return new Response(JSON.stringify(rows.map((r, i) => ({id: 'x' + i, source_url: r.source_url}))), {status: 201});
    }) as typeof fetch;
    const second = await runAutoEditor(db, {now: NOW + 5000, skipPull: true});
    assert.equal(second.published, 1, 'artikel yang gagal harus terbit pada percobaan berikutnya');
    assert.equal(sent.length, 1);
    const publish = second.steps.find(s => s.step === 'publish')!;
    assert.match(String(publish.detail), /percobaan ulang/);
    globalThis.fetch = originalFetch;
  } finally { await db.close(); restore(); }
});
