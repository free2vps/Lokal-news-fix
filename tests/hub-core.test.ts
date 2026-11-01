import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { addManualSource, governmentManifest, seedGovernmentSources } from '../src/server/hub/domain/sources';
import { acceptSourceItem, approveEditorial, editEditorial, normalizeArticleUrl, queuePublication, sourceTime } from '../src/server/hub/domain/editorial';
import { parseLombokTimurListing } from '../src/server/hub/adapters/lombok-timur-listing';
import { hasSession, isConfigured, loginOwner, logoutOwner, setupOwner } from '../src/server/hub/security/auth';
import { decryptSecret, encryptSecret } from '../src/server/hub/security/encryption';
import { readAiSettings, saveAiSetting } from '../src/server/hub/domain/ai-settings';
import { consumeNonce, verifyCollectorSignature } from '../src/server/hub/security/replay';
import { csrfAllowed, setSession } from '../src/server/hub/security/http';
import { NextResponse } from 'next/server';

async function fixture() {
  const db = createClient({ url: 'file::memory:' });
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  return db;
}
async function readySource(db: Awaited<ReturnType<typeof fixture>>, id = 'gov-ntb-lombok-timur', rights = 'metadata_only') {
  await seedGovernmentSources(db);
  await db.execute({ sql: "UPDATE hub_sources SET is_active=1,discovered_type='html_listing',rights_status=? WHERE id=?", args: [rights, id] });
}
const article = { sourceId: 'gov-ntb-lombok-timur', externalId: 'source-001', url: 'https://portal.lomboktimurkab.go.id/baca-berita-1-news.html', title: 'Judul dari sumber', snippet: 'Cuplikan sumber', sourcePublishedAt: '2026-10-27T09:30:00+08:00', sourceDateRaw: '27 Oktober 2026, 09.30 WITA' };

test('11 official sources register idempotently, remain inactive, and never overwrite edits', async () => {
  const db = await fixture();
  try {
    assert.equal(governmentManifest().length, 11);
    assert.equal((await seedGovernmentSources(db)).filter(r => r.status === 'inserted').length, 11);
    await db.execute("UPDATE hub_sources SET name='Nama hasil edit',rights_status='metadata_only' WHERE id='gov-ntb-lombok-timur'");
    const again = await seedGovernmentSources(db);
    assert.equal(again.filter(r => r.status === 'existing').length, 11);
    const count = (await db.execute('SELECT count(*) AS n FROM hub_sources')).rows[0]; assert.equal(Number(count.n), 11);
    const source = (await db.execute("SELECT * FROM hub_sources WHERE id='gov-ntb-lombok-timur'")).rows[0];
    assert.equal(source.name, 'Nama hasil edit'); assert.equal(source.rights_status, 'metadata_only'); assert.equal(source.source_kind, 'government_website'); assert.equal(Number(source.is_active), 0);
    assert.equal((await db.execute("SELECT id FROM hub_sources WHERE source_kind='rss' OR discovered_type='rss' OR is_active=1")).rows.length, 0);
  } finally { db.close(); }
});

test('same government domain already registered is flagged for review, not inserted or merged', async () => {
  const db = await fixture();
  try {
    await db.execute({ sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", args: ['existing', 'Sumber manual', 'Lombok Timur', 'NTB', 'https://portal.lomboktimurkab.go.id/other', 'https://portal.lomboktimurkab.go.id/other', 'lomboktimurkab.go.id', 'government_website', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'] });
    const result = await seedGovernmentSources(db);
    assert.equal(result.find(x => x.id === 'gov-ntb-lombok-timur')?.status, 'possible_duplicate');
    assert.equal(result.filter(x => x.status === 'inserted').length, 10);
    assert.equal((await db.execute("SELECT * FROM hub_sources WHERE id='gov-ntb-lombok-timur'")).rows.length, 0);
  } finally { db.close(); }
});

test('manual source addition is inactive, unverified, network-free and deduplicated', async () => {
  const db = await fixture();
  try {
    await seedGovernmentSources(db);
    const source = { name: 'Uji sumber', jurisdiction: 'Uji', region: 'NTB', url: 'https://example.test/rss', kind: 'rss' };
    const added = await addManualSource(db, source);
    assert.equal(added.active, false); assert.equal(added.verified, false);
    const row = (await db.execute({ sql: 'SELECT * FROM hub_sources WHERE id=?', args: [added.id] })).rows[0];
    assert.equal(row.discovered_type, 'unverified'); assert.equal(row.feed_url, null); assert.equal(Number(row.is_active), 0);
    await assert.rejects(() => addManualSource(db, source), /SOURCE_DUPLICATE/);
    await assert.rejects(() => addManualSource(db, { ...source, url: 'https://localhost/rss' }), /URL_INVALID/);
    await assert.rejects(() => addManualSource(db, { ...source, url: 'https://portal.lomboktimurkab.go.id/lain', kind: 'government_website' }), /SOURCE_POSSIBLE_DUPLICATE/);
  } finally { db.close(); }
});

test('Lombok Timur parser deduplicates headline/lihat links without inventing dates or going off-domain', () => {
  const html = `<h4><a href='/baca-berita-7871-judul-publik.html'>Judul publik yang tersedia</a></h4><a href='/baca-berita-7871-judul-publik.html'>lihat</a>
  <h4><a href='https://attacker.example/baca-berita-7872-judul-publik.html'>Tautan luar yang tidak boleh diterima</a></h4>
  <h4><a href='/baca-berita-7872-judul-kedua.html'>Judul publik kedua</a></h4>`;
  const parsed = parseLombokTimurListing(html);
  assert.equal(parsed.length, 2); assert.equal(parsed[0].externalId, 'lotim:7871'); assert.equal(parsed[0].sourcePublishedAt, null); assert.equal(parsed[0].snippet, null);
});

test('date handling requires explicit timezone and rejects invalid days; first-seen is not publication time', async () => {
  assert.equal(sourceTime('2026-10-27T09:30:00+08:00'), '2026-10-27T01:30:00.000Z');
  assert.throws(() => sourceTime('2026-10-27T09:30:00'), /DATE_NEEDS_EXPLICIT_TIMEZONE/);
  assert.throws(() => sourceTime('2026-02-31T09:30:00+08:00'), /DATE_INVALID/);
  assert.throws(() => normalizeArticleUrl('https://127.0.0.1/x'), /URL_INVALID/);
  const db = await fixture(); try {
    await readySource(db);
    const added = await acceptSourceItem(db, { ...article, sourcePublishedAt: null });
    const stored = (await db.execute({ sql: 'SELECT source_published_at,first_seen_at FROM hub_items WHERE id=?', args: [added.id] })).rows[0];
    assert.equal(stored.source_published_at, null); assert.ok(stored.first_seen_at);
    await assert.rejects(() => approveEditorial(db, added.id, 1, 'owner'), /SOURCE_DATE_REQUIRED/);
  } finally { db.close(); }
});

test('same-source duplicate is idempotent, manual edits survive and approval invalidates on changes', async () => {
  const db = await fixture(); try {
    await readySource(db);
    const first = await acceptSourceItem(db, article);
    assert.equal(first.status, 'inserted');
    await editEditorial(db, { id: first.id, expectedVersion: 1, editorialTitle: 'Judul manual', editorialSummary: 'Ringkasan manual', editorialCategory: 'Daerah' });
    await approveEditorial(db, first.id, 2, 'owner');
    const duplicate = await acceptSourceItem(db, article); assert.equal(duplicate.status, 'duplicate');
    let row = (await db.execute({ sql: 'SELECT * FROM hub_items WHERE id=?', args: [first.id] })).rows[0];
    assert.equal(row.editorial_title, 'Judul manual'); assert.equal(Number(row.version), 2); assert.equal(row.review_state, 'approved');
    const changed = await acceptSourceItem(db, { ...article, title: 'Judul sumber diperbarui' }); assert.equal(changed.status, 'updated');
    row = (await db.execute({ sql: 'SELECT * FROM hub_items WHERE id=?', args: [first.id] })).rows[0];
    assert.equal(row.editorial_title, 'Judul manual'); assert.equal(row.editorial_summary, 'Ringkasan manual'); assert.equal(Number(row.version), 3); assert.equal(row.approved_version, null); assert.equal(row.review_state, 'pending_review');
    assert.equal((await db.execute('SELECT * FROM hub_item_observations')).rows.length, 2);
    await assert.rejects(() => editEditorial(db, { id: first.id, expectedVersion: 2, editorialTitle: 'Edit usang', editorialSummary: null, editorialCategory: null }), /VERSION_CONFLICT/);
  } finally { db.close(); }
});

test('conflicting source date or URL is quarantined and repeated conflict does not mutate again', async () => {
  const db = await fixture(); try {
    await readySource(db); const first = await acceptSourceItem(db, article); await approveEditorial(db, first.id, 1, 'owner');
    const conflict = { ...article, sourcePublishedAt: '2026-10-28T09:30:00+08:00' };
    assert.equal((await acceptSourceItem(db, conflict)).status, 'identity_review');
    let row = (await db.execute({ sql: 'SELECT * FROM hub_items WHERE id=?', args: [first.id] })).rows[0];
    assert.equal(row.source_published_at, '2026-10-27T01:30:00.000Z'); assert.equal(row.review_state, 'identity_review'); assert.equal(Number(row.version), 2);
    await acceptSourceItem(db, conflict); row = (await db.execute({ sql: 'SELECT * FROM hub_items WHERE id=?', args: [first.id] })).rows[0]; assert.equal(Number(row.version), 2);
    await assert.rejects(() => approveEditorial(db, first.id, 2, 'owner'), /IDENTITY_REVIEW_REQUIRED/);
  } finally { db.close(); }
});

test('same URL across publishers keeps both attributions; same-source GUID collision is quarantined', async () => {
  const db = await fixture(); try {
    await readySource(db); await db.execute("UPDATE hub_sources SET is_active=1,discovered_type='rss',rights_status='metadata_only' WHERE id='gov-ntb-dompu'");
    const a = await acceptSourceItem(db, article);
    const b = await acceptSourceItem(db, { ...article, sourceId: 'gov-ntb-dompu', externalId: 'other-guid' });
    assert.notEqual(a.id, b.id);
    assert.equal((await db.execute({ sql: 'SELECT * FROM hub_items WHERE normalized_original_url=?', args: [article.url] })).rows.length, 2);
    const c = await acceptSourceItem(db, { ...article, externalId: 'different-guid' });
    assert.equal(c.status, 'identity_review');
    const rows = (await db.execute({ sql: 'SELECT id,review_state FROM hub_items WHERE source_id=?', args: [article.sourceId] })).rows;
    assert.equal(rows.length, 2); assert.ok(rows.every(r => r.review_state === 'identity_review'));
  } finally { db.close(); }
});

test('outbox requires approved version and rights; is idempotent and superseded after an edit', async () => {
  const db = await fixture(); try {
    await readySource(db); const first = await acceptSourceItem(db, article);
    await assert.rejects(() => queuePublication(db, first.id, 1), /APPROVAL_REQUIRED/);
    await approveEditorial(db, first.id, 1, 'owner');
    await assert.rejects(() => queuePublication(db, first.id, 1), /RIGHTS_REQUIRED/);
    await db.execute("UPDATE hub_sources SET rights_status='permission_confirmed' WHERE id='gov-ntb-lombok-timur'");
    const queued = await queuePublication(db, first.id, 1), again = await queuePublication(db, first.id, 1);
    assert.equal(queued.id, again.id); assert.equal(queued.delivered, false);
    const prior = (await db.execute('SELECT snapshot_json FROM hub_item_approvals')).rows[0].snapshot_json;
    await editEditorial(db, { id: first.id, expectedVersion: 1, editorialTitle: 'Koreksi redaksi', editorialSummary: null, editorialCategory: null });
    assert.equal((await db.execute('SELECT status FROM hub_publish_outbox')).rows[0].status, 'superseded');
    assert.equal((await db.execute('SELECT snapshot_json FROM hub_item_approvals')).rows[0].snapshot_json, prior);
    await assert.rejects(() => queuePublication(db, first.id, 1), /APPROVAL_REQUIRED/);
  } finally { db.close(); }
});

test('auth stores only password hash/session digest and expires/revokes sessions', async () => {
  const db = await fixture(); const now = 1_750_000_000_000; try {
    const secret = 'temporary-setup-token-with-at-least-32-characters';
    assert.equal(await isConfigured(db), false);
    assert.equal((await setupOwner(db, { password: 'a-secure-password', token: secret }, undefined, now)).ok, false);
    const created = await setupOwner(db, { password: 'a-secure-password', token: secret }, secret, now);
    assert.equal(created.ok, true); if (!created.ok) throw Error('unreachable');
    assert.equal(await hasSession(db, created.session, now + 1), true);
    assert.equal(await hasSession(db, created.session, now + 12 * 60 * 60_000), false);
    const credentials = JSON.stringify((await db.execute('SELECT * FROM hub_admin_credentials')).rows); const sessions = JSON.stringify((await db.execute('SELECT * FROM hub_admin_sessions')).rows);
    assert(!credentials.includes('a-secure-password')); assert(!sessions.includes(created.session));
    assert.equal((await loginOwner(db, 'incorrect-password', now + 1)).ok, false);
    const logged = await loginOwner(db, 'a-secure-password', now + 2); assert.equal(logged.ok, true); if (!logged.ok) throw Error('unreachable');
    await logoutOwner(db, logged.session); assert.equal(await hasSession(db, logged.session, now + 3), false);
  } finally { db.close(); }
});

test('durable global login limiter denies the eleventh attempt', async () => {
  const db = await fixture(); const now = 1_750_000_000_000; try {
    for (let i = 0; i < 10; i++) assert.equal((await loginOwner(db, 'wrong', now)).code, 'UNAUTHORIZED');
    assert.equal((await loginOwner(db, 'wrong', now)).code, 'RATE_LIMIT');
  } finally { db.close(); }
});

test('provider secrets are encrypted, bound to provider, never returned; OpenRouter requires :free', async () => {
  const db = await fixture(); const master = randomBytes(32).toString('base64'); const secret = 'sample-test-key-not-real';
  try {
    const a = encryptSecret(secret, 'groq', master), b = encryptSecret(secret, 'groq', master); assert.notEqual(a, b); assert(!a.includes(secret));
    assert.equal(decryptSecret(a, 'groq', master), secret); assert.throws(() => decryptSecret(a, 'cohere', master)); assert.throws(() => decryptSecret(a, 'groq', randomBytes(32).toString('base64')));
    await assert.rejects(() => saveAiSetting(db, { provider: 'openrouter', model: 'vendor/model', apiKey: secret }, master), /AI_MODEL_INVALID/);
    await saveAiSetting(db, { provider: 'openrouter', model: 'vendor/model:free', apiKey: secret }, master);
    await saveAiSetting(db, { provider: 'openrouter', model: 'vendor/another:free' }, master);
    const stored = (await db.execute('SELECT * FROM hub_ai_provider_settings')).rows[0];
    assert.equal(decryptSecret(String(stored.key_ciphertext), 'openrouter', master), secret);
    const publicInfo = await readAiSettings(db, master); assert(publicInfo.providers[0].keyConfigured); assert(!JSON.stringify(publicInfo).includes(secret)); assert(!JSON.stringify(publicInfo).includes(String(stored.key_ciphertext)));
    await assert.rejects(() => saveAiSetting(db, { provider: 'groq', model: 'model', apiKey: secret }, undefined), /MASTER_KEY_REQUIRED/);
  } finally { db.close(); }
});

test('signed collector contract rejects tampering, expiration and persistent nonce replay', async () => {
  const db = await fixture(); const now = 1_750_000_000_000, timestamp = String(now), nonce = 'test_nonce_12345678901234567890', rawBody = '{"items":[]}', secret = 'test-secret-with-at-least-32-characters';
  try {
    const digest = createHash('sha256').update(rawBody).digest('hex');
    const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${digest}`).digest('hex');
    const input = { timestamp, nonce, signature, rawBody };
    assert(verifyCollectorSignature(input, secret, now)); assert(!verifyCollectorSignature({ ...input, rawBody: 'changed' }, secret, now)); assert(!verifyCollectorSignature(input, secret, now + 301_000));
    assert.equal(await consumeNonce(db, nonce, now), true); assert.equal(await consumeNonce(db, nonce, now + 1), false);
  } finally { db.close(); }
});

test('CSRF requires same origin and custom header; cookie is HttpOnly and Secure on HTTPS', () => {
  const ok = new Request('https://hub.example.com/api/hub/auth/login', { method: 'POST', headers: { origin: 'https://hub.example.com', 'x-hub-request': '1' } });
  const bad = new Request('https://hub.example.com/api/hub/auth/login', { method: 'POST', headers: { origin: 'https://evil.example.com', 'x-hub-request': '1' } });
  assert.equal(csrfAllowed(ok), true); assert.equal(csrfAllowed(bad), false);
  assert.equal(csrfAllowed(new Request('https://hub.example.com/api/hub/auth/login', { method: 'POST', headers: { origin: 'https://hub.example.com' } })), false);
  const response = NextResponse.json({ ok: true }); setSession(response, ok, 'a'.repeat(64)); const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  const proxied = new Request('http://0.0.0.0:3007/api/hub/auth/login', { method: 'POST', headers: { host: '3007-test.e2b.app', origin: 'https://3007-test.e2b.app', 'x-forwarded-proto': 'https', 'x-hub-request': '1' } });
  assert.equal(csrfAllowed(proxied), true);
  const previewResponse = NextResponse.json({ ok: true }); setSession(previewResponse, proxied, 'a'.repeat(64));
  assert.match(previewResponse.headers.get('set-cookie') || '', /SameSite=None; Partitioned/);
});
