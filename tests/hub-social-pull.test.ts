import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
  prepareSocialSchema, enqueuePublished, claimBatch, acknowledge, socialStatus,
  issueSocialToken, revokeSocialToken, verifySocialToken, requeueFailed, SOCIAL_POLICY, siteBase,
} from '../src/server/hub/domain/social-pull';
import AdvancedTools from '../src/components/hub/AdvancedTools';

const NOW = Date.parse('2026-10-30T09:00:00Z');
const SITE = 'https://contoh-situs.example';

async function fixture(published = 6, opts: {env?: NodeJS.ProcessEnv} = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'social-'));
  const db = createClient({url: 'file:' + path.join(dir, 's.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute("INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES('s1','Media NTB','Provinsi','NTB','https://satu.example.org','https://satu.example.org','satu.example.org','rss','permission_confirmed','2026-10-30','2026-10-30')");
  for (let i = 1; i <= published; i++) {
    const id = `legacy-news:00000000-0000-0000-0000-00000000000${i}`;
    const snapshot = JSON.stringify({id, sourceId: 's1', originalUrl: 'https://satu.example.org/' + i, sourceTitle: 'Judul sumber ' + i, sourceSnippet: 'Snippet ' + i, sourcePublishedAt: '2026-10-30T08:00:00Z', editorialTitle: 'Beasiswa pelajar Lombok dibuka ' + i, editorialSummary: 'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar dan mahasiswa berprestasi melalui portal resmi.', editorialCategory: 'Pendidikan', version: 1});
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category,version,review_state,approved_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, 's1', 'k' + i, 'https://satu.example.org/' + i, 'https://satu.example.org/' + i, 'Judul sumber ' + i, 'Snippet ' + i, '2026-10-30T08:00:00Z', '2026-10-30', '2026-10-30', 'Beasiswa pelajar Lombok dibuka ' + i, 'Ringkasan editorial untuk berita ' + i, 'Pendidikan', 1, 'approved', 1]});
    await db.execute({sql: 'INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES(?,1,?,?,?)', args: [id, snapshot, '2026-10-30T08:30:00Z', 'owner']});
    await db.execute({sql: "INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at) VALUES(?,?,?,?,?,'published',?)", args: ['o' + i, 'k' + i, id, 1, snapshot, '2026-10-30T08:40:00Z']});
  }
  await prepareSocialSchema(db);
  const close = db.close.bind(db);
  (db as any).close = async (...args: any[]) => { await (close as any)(...args); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return db;
}

test('stage9 queue is filled only from articles already published on the site', async () => {
  const db = await fixture(3);
  try {
    const out = await enqueuePublished(db, NOW);
    assert.equal(out.examined, 3);
    assert.equal(out.inserted, 3);
    const again = await enqueuePublished(db, NOW);
    assert.equal(again.inserted, 0, 'idempotent');
    const status = await socialStatus(db);
    assert.equal(status.pending, 3);
    assert.equal(status.facebookMaxPerRun, 4);
    assert.equal(SOCIAL_POLICY.deliverySemantics, 'at_least_once');
    assert.equal(SOCIAL_POLICY.facebookPostedBy, 'make.com');
  } finally { await db.close(); }
});

test('stage9 pull returns at most 4 items and leases the rest', async () => {
  const db = await fixture(6);
  try {
    await enqueuePublished(db, NOW);
    const first = await claimBatch(db, {max: 4, label: 'make', now: NOW, env: {}} as any);
    assert.equal(first.count, 4);
    assert.equal(first.limit, 4);
    assert.equal(first.remaining, 2);
    assert.ok(first.items.every(i => /^[a-f0-9]{32}$/.test(i.deliveryKey)));
    assert.ok(first.items[0].title.length > 0 && first.items[0].summary.length > 0);
    assert.equal(first.items[0].articleUrlSource, 'original', 'tanpa HUB_PUBLIC_SITE_URL tautan memakai URL sumber');
    const second = await claimBatch(db, {max: 4, label: 'make', now: NOW + 1000, env: {}} as any);
    assert.equal(second.count, 2);
    const third = await claimBatch(db, {max: 4, label: 'make', now: NOW + 2000, env: {}} as any);
    assert.equal(third.count, 0, 'semua masih ter-lease');
    const over = await claimBatch(db, {max: 99, label: 'make', now: NOW + 3000, env: {}} as any);
    assert.equal(over.limit, SOCIAL_POLICY.hardMaxPerPull);
  } finally { await db.close(); }
});

test('stage9 ack marks delivered; missing ack returns items after lease; failures are counted', async () => {
  const db = await fixture(6);
  try {
    await enqueuePublished(db, NOW);
    const batch = await claimBatch(db, {max: 4, now: NOW, env: {}} as any);
    const ack = await acknowledge(db, batch.items.slice(0, 2).map(i => ({deliveryKey: i.deliveryKey, ok: true})), 'make', NOW + 1000);
    assert.equal(ack.delivered, 2);
    const fail = await acknowledge(db, [{deliveryKey: batch.items[2].deliveryKey, ok: false, error: 'facebook 500'}], 'make', NOW + 1500);
    assert.equal(fail.failed, 1);
    const st = await socialStatus(db);
    assert.equal(st.delivered, 2);
    assert.equal(st.failed, 1);
    // Item ke-4 belum di-ack: tetap claimed sampai lease 6 jam habis. Sisa 2 item masih pending.
    assert.equal((await claimBatch(db, {max: 4, now: NOW + 2000, env: {}} as any)).count, 2);
    const afterLease = await claimBatch(db, {max: 4, now: NOW + SOCIAL_POLICY.claimLeaseMs + 500, env: {}} as any);
    assert.equal(afterLease.count, 1, 'hanya item tanpa ack yang kembali ke antrean');
    await assert.rejects(() => acknowledge(db, [{deliveryKey: 'bukan-hex', ok: true}]), /ACK_INVALID/);
    const requeued = await requeueFailed(db, NOW + 9000);
    assert.ok(requeued.requeued >= 1);
  } finally { await db.close(); }
});

test('stage9 expired claims past max attempts become failed, not infinite retries', async () => {
  const db = await fixture(1);
  try {
    await enqueuePublished(db, NOW);
    await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='claimed',attempts=9,claimed_until=?", args: [NOW - 1000]});
    await claimBatch(db, {max: 4, now: NOW, env: {}} as any);
    const row = (await db.execute('SELECT status,last_error FROM hub_social_queue_v2')).rows[0];
    assert.equal(String(row.status), 'failed');
    assert.equal(String(row.last_error), 'CLAIM_EXPIRED');
  } finally { await db.close(); }
});

test('stage9 tokens are hashed, verifiable, revocable and gate the pull endpoint', async () => {
  const db = await fixture(2);
  try {
    const issued = await issueSocialToken(db, 'make.com', NOW);
    assert.match(issued.token, /^[0-9a-f]{64}$/);
    assert.deepEqual(issued.scopes, ['pull', 'ack']);
    const stored = (await db.execute('SELECT token_hash FROM hub_social_tokens_v2')).rows[0];
    assert.notEqual(String(stored.token_hash), issued.token);
    assert.equal(await verifySocialToken(db, 'Bearer ' + issued.token, NOW), true);
    assert.equal(await verifySocialToken(db, 'Bearer ' + 'f'.repeat(64), NOW), false);
    assert.equal(await verifySocialToken(db, null, NOW), false);
    const id = String((await db.execute('SELECT id FROM hub_social_tokens_v2')).rows[0].id);
    await revokeSocialToken(db, id, NOW);
    assert.equal(await verifySocialToken(db, 'Bearer ' + issued.token, NOW), false);
    await assert.rejects(() => revokeSocialToken(db, 'x'), /TOKEN_INVALID/);
  } finally { await db.close(); }
});

test('stage9 site link uses /berita/{slug} only when HUB_PUBLIC_SITE_URL is a valid https origin', async () => {
  assert.equal(siteBase({HUB_PUBLIC_SITE_URL: ''} as any), null);
  assert.equal(siteBase({HUB_PUBLIC_SITE_URL: 'http://tidak-aman.example'} as any), null);
  assert.equal(siteBase({HUB_PUBLIC_SITE_URL: 'https://user:pass@x.example'} as any), null);
  assert.equal(siteBase({HUB_PUBLIC_SITE_URL: SITE} as any), SITE);
  const db = await fixture(1);
  try {
    await enqueuePublished(db, NOW);
    const out = await claimBatch(db, {max: 4, now: NOW, env: {HUB_PUBLIC_SITE_URL: SITE} as any});
    assert.equal(out.items[0].articleUrlSource, 'site');
    assert.ok(out.items[0].articleUrl.startsWith(SITE + '/berita/'));
    assert.ok(out.items[0].articleUrl.includes('-hub-'));
  } finally { await db.close(); }
});

test('stage9 pull and ack API reject anonymous callers and unknown actions', async () => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const pathMod = (await import('node:path')).default;
  const osMod = (await import('node:os')).default;
  const {setupOwner} = await import('../src/server/hub/security/auth');
  const dir = await mkdtemp(pathMod.join(osMod.tmpdir(), 'social-api-')); const url = 'file:' + pathMod.join(dir, 'a.db');
  const db = createClient({url});
  const keys = ['HUB_DATABASE_URL', 'HUB_ALLOW_LOCAL_DB', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF'], old = keys.map(k => process.env[k]);
  try {
    await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
    const user = await setupOwner(db, {token: 'test-setup-token-long-enough-not-real', password: 'social-api-password-test'}, 'test-setup-token-long-enough-not-real');
    if (!user.ok) throw Error('fixture');
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'webhub';
    const route = await import('../src/app/api/hub/social/route');
    const origin = 'http://localhost:3100';
    const headers = {cookie: 'hub_session=' + user.session};
    const post = (body: unknown, csrf = true) => new Request(origin + '/api/hub/social', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json', ...(csrf ? {origin, 'X-Hub-Request': '1'} : {})}, body: JSON.stringify(body)});

    assert.equal((await route.GET(new Request(origin + '/api/hub/social'))).status, 401);
    const first = await (await route.GET(new Request(origin + '/api/hub/social', {headers}))).json();
    assert.equal(first.ready, false);
    assert.equal(first.facebookMaxPerRun, 4);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE SOCIAL'}, false))).status, 403);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE SOCIAL'}))).status, 200);
    const anonPull = await route.POST(new Request(origin + '/api/hub/social?action=pull', {method: 'POST', headers: {authorization: 'Bearer ' + 'c'.repeat(64)}}));
    assert.equal(anonPull.status, 401);
    const issued = await (await route.POST(post({action: 'issueToken', confirm: 'ISSUE SOCIAL TOKEN', label: 'make'}))).json();
    const pulled = await route.POST(new Request(origin + '/api/hub/social?action=pull&max=4', {method: 'POST', headers: {authorization: 'Bearer ' + issued.token}}));
    assert.equal(pulled.status, 200);
    const out = await pulled.json();
    assert.equal(out.count, 0, 'antrean kosong tanpa artikel terbit');
    assert.equal(out.limit, 4);
    assert.equal((await route.POST(post({action: 'unknown'}))).status, 400);
    process.env.VERCEL_ENV = 'production';
    assert.equal((await route.POST(new Request(origin + '/api/hub/social?action=pull', {method: 'POST', headers: {authorization: 'Bearer ' + issued.token}}))).status, 403);
  } finally {
    db.close();
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    await rm(dir, {recursive: true, force: true});
  }
});

test('panel Lanjutan menyebut batas Facebook dan asal token, tanpa tombol berlebih', () => {
  const html = renderToStaticMarkup(React.createElement(AdvancedTools, {}));
  assert.ok(html.includes('Kirim ke Facebook lewat Make'));
  assert.ok(html.includes('per tarikan'), 'batas 4 per tarikan tetap dijelaskan');
  assert.ok(html.includes('Token Facebook tetap disimpan di Make'));
  assert.ok(html.includes('Buat token Make'));
  const buttons = (html.match(/<button/g) || []).length;
  assert.ok(buttons <= 6, `maksimum 6 tombol di Lanjutan, ditemukan ${buttons}`);
});
