import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
  extractiveSummary, needsAi, summarizeGate, validateAiSummary, prepareSummarySchema, scanCandidates,
  runSummaryBatch, applySummary, summaryStatus, SUMMARY_POLICY, SUMMARY_VERSION,
} from '../src/server/hub/domain/ai-summary';
import {encryptSecret} from '../src/server/hub/security/encryption';
import SummaryManager from '../src/components/hub/AiSummaries';

const NOW = Date.parse('2026-10-30T04:00:00Z');
const stamp = new Date(NOW - 3 * 3600000).toISOString();
const MASTER = Buffer.alloc(32, 7).toString('base64');

const TITLE = 'Beasiswa pelajar Lombok dibuka hingga akhir bulan';
const LONG = 'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar dan mahasiswa berprestasi. Pendaftaran dilakukan melalui portal resmi dan memerlukan kartu pelajar, rapor semester terakhir, serta surat keterangan aktif dari sekolah. Kuota terbatas dan seleksi dilakukan berdasarkan nilai akademik serta kondisi ekonomi keluarga. Hasil seleksi diumumkan melalui kanal resmi pemerintah provinsi.';
const THIN = 'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar dan mahasiswa berprestasi melalui portal resmi. Syarat pendaftaran belum dirinci seluruhnya...';

type Item = {id: string; title?: string; snippet?: string | null; version?: number; summary?: string | null; region?: string; rights?: string; state?: string; publishedAt?: string | null};

async function fixture(items: Item[], opts: {ai?: boolean; attempts?: number} = {}) {
  const db = createClient({url: 'file::memory:'});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute("INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES('s','Sumber NTB','Provinsi','NTB','https://example.org','https://example.org','example.org','rss','metadata_only','2026-10-30','2026-10-30')");
  await db.execute("INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES('n','Sumber Nasional','Nasional','Nasional','https://example.net','https://example.net','example.net','rss','metadata_only','2026-10-30','2026-10-30')");
  for (const it of items) {
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_summary,version,review_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [it.id, (it.region || 'NTB') === 'NTB' ? 's' : 'n', 'id-' + it.id, 'https://example.org/' + it.id, 'https://example.org/' + it.id,
        it.title ?? TITLE, it.snippet === undefined ? LONG : it.snippet, it.publishedAt === undefined ? stamp : it.publishedAt,
        '2026-10-30', '2026-10-30', it.summary ?? null, it.version ?? 1, it.state ?? 'pending_review']});
  }
  if (opts.ai) {
    await db.execute('CREATE TABLE hub_ai_policy_v2 (id TEXT PRIMARY KEY,allow_public INTEGER NOT NULL DEFAULT 0,groq_free INTEGER NOT NULL DEFAULT 0)');
    await db.execute("INSERT INTO hub_ai_policy_v2(id,allow_public) VALUES('owner',1)");
    await db.execute({sql: 'INSERT INTO hub_ai_provider_settings(provider,model,key_ciphertext,updated_at) VALUES(?,?,?,?)', args: ['openrouter', 'openrouter/free', encryptSecret('test-key-not-real-1234', 'openrouter', MASTER), '2026-10-30']});
  }
  await prepareSummarySchema(db);
  if (opts.attempts) await db.execute({sql: 'INSERT INTO hub_ai_daily_v2(day,attempts) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET attempts=excluded.attempts', args: [new Date(NOW).toISOString().slice(0, 10), opts.attempts]});
  return db;
}

const okFetcher = (body: string, counter: {calls: number}) => (async () => { counter.calls += 1; return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({summary: body})}}], usage: {prompt_tokens: 210, completion_tokens: 95}}), {status: 200}); }) as unknown as typeof fetch;

const id = (n: number) => `legacy-news:00000000-0000-0000-0000-00000000000${n}`;

test('stage4 extractive path is verbatim, deterministic and needs no tokens', () => {
  const out = extractiveSummary(LONG);
  assert.ok(out.length > 0 && out.length <= SUMMARY_POLICY.extractiveMaxChars);
  assert.ok(LONG.includes(out.trim()));
  assert.equal(out, extractiveSummary(LONG));
  assert.notEqual(extractiveSummary(LONG), extractiveSummary(LONG.slice(80)));
  assert.equal(needsAi(LONG, out), false);
  assert.equal(needsAi(THIN, extractiveSummary(THIN)), true);
  assert.equal(extractiveSummary(''), '');
  assert.ok(extractiveSummary(`Baca juga: berita lain yang tidak relevan. ${LONG}`).startsWith('Pemerintah'));
});

test('stage4 gates block outside regions, unconfirmed rights, stale dates, existing editorial and risk flags', () => {
  const base = {review_state: 'pending_review', region: 'NTB', rights_status: 'metadata_only', source_published_at: stamp, source_title: TITLE, source_snippet: LONG, editorial_summary: null, profile_json: null} as any;
  assert.equal(summarizeGate(base, NOW, 72).eligible, true);
  assert.equal(summarizeGate({...base, region: 'Nasional'}, NOW, 72).code, 'region_outside');
  assert.equal(summarizeGate({...base, rights_status: 'unknown'}, NOW, 72).code, 'rights_unconfirmed');
  assert.equal(summarizeGate({...base, source_published_at: '2026-10-01T00:00:00Z'}, NOW, 72).code, 'date_invalid');
  assert.equal(summarizeGate({...base, source_published_at: '2026-10-30 10:00:00'}, NOW, 72).code, 'date_invalid');
  assert.equal(summarizeGate({...base, editorial_summary: 'Editan manual'}, NOW, 72).code, 'editorial_present');
  assert.equal(summarizeGate({...base, review_state: 'rejected'}, NOW, 72).code, 'state_blocked');
  assert.equal(summarizeGate({...base, profile_json: JSON.stringify({risk: {status: 'needs_review'}})}, NOW, 72).code, 'risk_needs_review');
  assert.equal(summarizeGate({...base, source_snippet: 'Pendek.'}, NOW, 72).code, 'text_too_short');
  assert.equal(summarizeGate({...base, region: 'Nasional', profile_json: JSON.stringify({regions: ['Bali']})}, NOW, 72).eligible, true);
});

test('stage4 AI output is rejected when it invents numbers, words or markup', () => {
  const source = `${TITLE} ${LONG}`;
  assert.ok(validateAiSummary('Pendaftaran beasiswa untuk pelajar dan mahasiswa dibuka melalui portal resmi dengan syarat rapor dan surat keterangan aktif sekolah.', source).includes('beasiswa'));
  assert.throws(() => validateAiSummary('Beasiswa dibuka untuk 5000 pelajar dengan anggaran Rp 25 miliar dari kementerian.', source), /UNGROUNDED/);
  assert.throws(() => validateAiSummary('**Beasiswa** dibuka untuk pelajar dan mahasiswa melalui portal resmi dengan banyak syarat administrasi lengkap.', source), /INVALID/);
  assert.throws(() => validateAiSummary('Zebra kuantum orbit neutrino galaksi laminar vorteks dan pulsar kuark gluon plasma.', source), /UNGROUNDED/);
  assert.throws(() => validateAiSummary('Pendek.', source), /INVALID/);
});

test('stage4 batch prefers zero-token extractive summaries and never touches editorial fields', async () => {
  const db = await fixture([{id: id(1)}, {id: id(2), title: 'Pelatihan nelayan Kupang dibuka'}, {id: id(3), region: 'Nasional'}]);
  try {
    const before = (await db.execute('SELECT * FROM hub_items ORDER BY id')).rows;
    let calls = 0;
    const fetcher = (async () => { calls += 1; throw Error('must not be called'); }) as unknown as typeof fetch;
    const out = await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher, now: NOW, maxItems: 5});
    assert.equal(calls, 0);
    assert.equal(out.aiCalls, 0);
    assert.equal(out.tokensUsedTotal, 0);
    assert.equal(out.kindCounts.extractive, 2);
    assert.equal(out.written, 2);
    assert.equal(out.publicationEnabled, false);
    assert.deepEqual((await db.execute('SELECT * FROM hub_items ORDER BY id')).rows, before);
    const rows = (await db.execute('SELECT kind,provider FROM hub_ai_summaries_v2 ORDER BY item_id')).rows;
    assert.deepEqual(rows.map(r => String(r.kind)), ['extractive', 'extractive']);
    assert.deepEqual(rows.map(r => r.provider), [null, null]);
    const again = await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher, now: NOW, maxItems: 5});
    assert.equal(again.processed, 0);
    assert.equal(again.stopped, 'all_cached');
    assert.equal((await summaryStatus(db)).stored, 2);
  } finally { db.close(); }
});

test('stage4 thin metadata uses one AI call, is stored as suggestion, and a repeat costs no tokens', async () => {
  const db = await fixture([{id: id(1), snippet: THIN}], {ai: true});
  const summary = 'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar melalui portal resmi.';
  const counter = {calls: 0};
  try {
    const out = await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher: okFetcher(summary, counter), now: NOW, maxItems: 5});
    assert.equal(counter.calls, 1);
    assert.equal(out.aiCalls, 1);
    assert.equal(out.kindCounts.ai, 1);
    assert.ok(out.tokensIn >= 1 && out.tokensOut >= 1);
    assert.ok(out.tokensUsedTotal <= 900);
    assert.equal((await db.execute('SELECT editorial_summary FROM hub_items')).rows[0].editorial_summary, null);
    assert.equal(Number((await db.execute('SELECT version FROM hub_items')).rows[0].version), 1);
    const repeat = await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher: okFetcher(summary, counter), now: NOW, maxItems: 5});
    assert.equal(counter.calls, 1, 'cache must prevent a second provider call');
    assert.equal(repeat.aiCalls, 0);
    assert.equal(repeat.stopped, 'all_cached');
    await db.execute('DELETE FROM hub_ai_summaries_v2');
    const reused = await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher: okFetcher(summary, counter), now: NOW, maxItems: 5});
    assert.equal(counter.calls, 1);
    assert.equal(reused.kindCounts.reuse, 1);
    assert.ok(reused.tokensSaved > 0);
  } finally { db.close(); }
});

test('stage4 daily quota is enforced without writing unvalidated summaries', async () => {
  const db = await fixture([{id: id(1), snippet: THIN}], {ai: true, attempts: 20});
  const counter = {calls: 0};
  try {
    const out = await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher: okFetcher('Beasiswa pelajar Lombok dibuka melalui portal resmi pemerintah provinsi.', counter), now: NOW, maxItems: 5});
    assert.equal(counter.calls, 0);
    assert.equal(out.written, 0);
    assert.equal(out.stopped, 'quota_or_provider');
    assert.equal(out.quotaRemainingToday, 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_ai_summaries_v2')).rows[0].n), 0);
    assert.equal((await db.execute('SELECT editorial_summary FROM hub_items')).rows[0].editorial_summary, null);
  } finally { db.close(); }
});

test('stage4 without consent or keys only extractive summaries run and no network call happens', async () => {
  const db = await fixture([{id: id(1), snippet: THIN}]);
  let calls = 0;
  const fetcher = (async () => { calls += 1; throw Error('must not be called'); }) as unknown as typeof fetch;
  try {
    const out = await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher, now: NOW, maxItems: 5});
    assert.equal(calls, 0);
    assert.equal(out.written, 0);
    assert.equal(out.stopped, 'quota_or_provider');
    assert.equal(out.aiBlocked, 'SUMMARY_CONSENT_REQUIRED');
    assert.equal(out.extractiveOnly, true);
  } finally { db.close(); }
});

test('stage4 applying a suggestion needs explicit action, preserves manual edits and bumps version only', async () => {
  const db = await fixture([{id: id(1)}, {id: id(2), summary: 'Ringkasan manual'}]);
  try {
    await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher: (async () => { throw Error('no network'); }) as unknown as typeof fetch, now: NOW, maxItems: 5});
    await assert.rejects(() => applySummary(db, id(1), 7, NOW), /CONFLICT/);
    const applied = await applySummary(db, id(1), 1, NOW);
    assert.equal(applied.applied, true);
    assert.equal(applied.version, 2);
    assert.equal(applied.publicationEnabled, false);
    assert.equal(Number((await db.execute({sql: 'SELECT version FROM hub_items WHERE id=?', args: [id(1)]})).rows[0].version), 2);
    await assert.rejects(() => applySummary(db, id(1), 2, NOW), /EDITORIAL_PRESENT/);
    assert.equal((await db.execute({sql: 'SELECT editorial_summary FROM hub_items WHERE id=?', args: [id(2)]})).rows[0].editorial_summary, 'Ringkasan manual');
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_item_approvals')).rows[0].n), 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_ai_summaries_v2 WHERE applied_at IS NOT NULL')).rows[0].n), 1);
  } finally { db.close(); }
});

test('stage4 scan reports why items are skipped and never fabricates candidates', async () => {
  const db = await fixture([{id: id(1)}, {id: id(2), region: 'Nasional'}, {id: id(3), publishedAt: null}, {id: id(4), summary: 'Manual', title: 'Pelatihan UMKM Mataram dibuka pekan depan'}]);
  try {
    const plan = await scanCandidates(db, 72, NOW);
    assert.equal(plan.scanned, 4);
    assert.equal(plan.candidates.length, 1);
    assert.equal(plan.reasons.region_outside, 1);
    assert.equal(plan.reasons.date_invalid, 1);
    assert.equal(plan.reasons.editorial_present, 1);
    assert.equal(plan.estimatedTokensNextRun, 0);
    assert.equal(plan.publicationEnabled, false);
    const withEditorial = await scanCandidates(db, 72, NOW, true);
    assert.equal(withEditorial.candidates.length, 2);
    assert.equal(withEditorial.existingEditorialIncluded, 1);
    const forced = await runSummaryBatch(db, {freshnessHours: 72, master: MASTER, fetcher: (async () => { throw Error('no network'); }) as unknown as typeof fetch, now: NOW, maxItems: 5, includeEditorial: true});
    assert.ok(forced.written >= 1);
    assert.equal((await db.execute({sql: 'SELECT editorial_summary FROM hub_items WHERE id=?', args: [id(4)]})).rows[0].editorial_summary, 'Manual');
    const scan = await scanCandidates(await fixture([{id: id(5), snippet: THIN}]), 72, NOW);
    assert.equal(scan.aiPending, 1);
    assert.ok(scan.estimatedTokensNextRun > 0);
  } finally { db.close(); }
});

test('stage4 UI explains token saving, source limits and that summaries are suggestions', () => {
  const html = renderToStaticMarkup(React.createElement(SummaryManager, {}));
  assert.ok(html.includes('Ringkasan AI hemat token'));
  assert.ok(html.includes('judul dan cuplikan publik'));
  assert.ok(html.includes('tidak dibuka'));
  assert.ok(html.includes('Buat ringkasan bertahap'));
  assert.ok(SUMMARY_VERSION === 'summary_v1' && SUMMARY_POLICY.maxItemsPerRequest === 5 && SUMMARY_POLICY.publicationEnabled === false);
});
