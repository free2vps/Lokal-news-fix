import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
  preparePublishSchema, readConfig, updateConfig, buildPlan, dryRun, arm, disarm, publishArmed,
  publishStatus, PUBLISH_POLICY, DEFAULT_CONFIG, targetConfigured,
} from '../src/server/hub/domain/publish-policy';
import {supabaseDeliver, articleRow} from '../src/server/hub/domain/publish-delivery';
import AutopublishPanel from '../src/components/hub/AutopublishPanel';
import {prepareProfiles, profileBatch} from '../src/server/hub/domain/content-profile';
import {prepareValues, valueBatch} from '../src/server/hub/domain/editorial-value';
import {prepareSummarySchema} from '../src/server/hub/domain/ai-summary';

const NOW = Date.parse('2026-10-30T06:00:00Z');
const SRC = '11111111-1111-1111-1111-111111111111';
const id = (n: number) => `legacy-news:00000000-0000-0000-0000-00000000000${n}`;
const okDeliver = (counter = {calls: 0}) => (async (items: any[]) => {
  counter.calls += 1;
  return {published: items.map(i => i.id), duplicates: [], failed: [], target: 'fake'};
}) as any;

async function fixture(opts: {rights?: string; approve?: boolean; region?: string; risk?: boolean; summary?: boolean} = {}) {
  // DB file unik per fixture: `file::memory:` dapat dipakai bersama antar klien dalam satu proses.
  const {mkdtempSync} = await import('node:fs');
  const pathMod = (await import('node:path')).default;
  const osMod = (await import('node:os')).default;
  const dir = mkdtempSync(pathMod.join(osMod.tmpdir(), 'stage8-'));
  const db = createClient({url: 'file:' + pathMod.join(dir, 'p.db')});
  (db as any).__dir = dir;
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute({sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES(?,'Media NTB','Provinsi',?,'https://satu.example.org','https://satu.example.org','satu.example.org','rss',?,'2026-10-30','2026-10-30')", args: [SRC, opts.region || 'NTB', opts.rights || 'permission_confirmed']});
  const summaryText = 'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar dan mahasiswa berprestasi melalui portal resmi.';
  for (const n of [1, 2]) {
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category,version,review_state,approved_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id(n), SRC, 'k' + n, 'https://satu.example.org/' + n, 'https://satu.example.org/' + n, 'Beasiswa pelajar Lombok dibuka ' + n, 'Cuplikan berita daerah.',
        '2026-10-30T03:00:0' + n + 'Z', '2026-10-30', '2026-10-30', 'Beasiswa pelajar Lombok dibuka ' + n, opts.summary === false ? null : summaryText, 'Pendidikan', 1,
        opts.approve === false ? 'pending_review' : 'approved', opts.approve === false ? null : 1]});
    if (opts.approve !== false) {
      const snap = JSON.stringify({id: id(n), sourceId: SRC, originalUrl: 'https://satu.example.org/' + n, sourceTitle: 'Beasiswa pelajar Lombok dibuka ' + n, sourceSnippet: 'Cuplikan berita daerah.', sourcePublishedAt: '2026-10-30T03:00:0' + n + 'Z', sourceDateRaw: null, editorialTitle: 'Beasiswa pelajar Lombok dibuka ' + n, editorialSummary: summaryText, editorialCategory: 'Pendidikan', version: 1});
      await db.execute({sql: 'INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES(?,1,?,?,?)', args: [id(n), snap, '2026-10-30T04:00:00Z', 'owner']});
    }
  }
  await prepareProfiles(db); await profileBatch(db, '');
  await prepareValues(db); await valueBatch(db, '');
  await prepareSummarySchema(db);
  if (opts.risk) {
    await db.execute(`INSERT OR REPLACE INTO hub_content_profiles_v2 VALUES(?,?,?,?,?,?)`, [id(1), 1, 'x', JSON.stringify({regions: ['NTB'], usefulness: ['peluang'], risk: {status: 'needs_review'}}), '2026-10-30', '2026-10-30']);
    await valueBatch(db, '');
  }
  await preparePublishSchema(db);
  const close = db.close.bind(db);
  (db as any).close = async (...args: any[]) => { await (close as any)(...args); const d = (db as any).__dir; if (d) { try { (await import('node:fs')).rmSync(d, {recursive: true, force: true}); } catch {} } };
  return db;
}

test('stage8 defaults are off: dry-run mode, empty source allowlist, nothing published', async () => {
  const db = await fixture();
  try {
    const cfg = await readConfig(db);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.mode, 'dry_run');
    assert.deepEqual(cfg.allowSourceIds, []);
    assert.deepEqual(cfg.allowRegions, DEFAULT_CONFIG.allowRegions);
    assert.equal(PUBLISH_POLICY.defaultEnabled, false);
    assert.equal(PUBLISH_POLICY.schedulerConfigured, false);
    assert.equal(PUBLISH_POLICY.homepageLayoutChanged, false);
    assert.equal(targetConfigured(), false, 'no delivery credentials in this environment');
    await assert.rejects(() => arm(db, 'a'.repeat(64), 'ARM AUTOPUBLISH', 'owner', NOW), /ALLOWLIST_EMPTY/);
    await assert.rejects(() => publishArmed(db, 'owner', okDeliver(), NOW), /NOT_ARMED/);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_items WHERE review_state=\'approved\'')).rows[0].n), 2, 'approval state untouched');
  } finally { await db.close(); }
});

test('stage8 plan applies every gate and reports why items are excluded', async () => {
  const notApproved = await fixture({approve: false});
  const wrongRights = await fixture({rights: 'metadata_only'});
  const risk = await fixture({risk: true});
  const noSummary = await fixture({summary: false});
  try {
    for (const db of [notApproved, wrongRights, risk, noSummary]) {
      await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar'}, 'owner');
    }
    assert.equal((await buildPlan(notApproved, NOW)).eligible, 0);
    assert.equal((await buildPlan(notApproved, NOW)).reasons.not_approved, undefined, 'query only selects approved rows');
    const rightsPlan = await buildPlan(wrongRights, NOW);
    assert.equal(rightsPlan.eligible, 0);
    assert.equal(rightsPlan.reasons.rights_not_permission_confirmed, 2);
    const riskPlan = await buildPlan(risk, NOW);
    assert.ok(riskPlan.reasons.risk_needs_review >= 1);
    const noTextPlan = await buildPlan(noSummary, NOW);
    assert.equal(noTextPlan.reasons.editorial_text_missing, 2);
    // Wilayah ditentukan dari isi berita (profil), bukan dari wilayah penerbit.
    const otherRegion = await fixture();
    try {
      await updateConfig(otherRegion, {allowSourceIds: [SRC], allowRegions: ['Bali'], minValueTier: 'radar'}, 'owner');
      const p = await buildPlan(otherRegion, NOW);
      assert.equal(p.eligible, 0);
      assert.equal(p.reasons.region_not_allowlisted, 2);
    } finally { await otherRegion.close(); }
  } finally { for (const db of [notApproved, wrongRights, risk, noSummary]) await db.close(); }
});

test('stage8 tier floor, source allowlist and window all block publication', async () => {
  const db = await fixture();
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar', windowHours: 72}, 'owner');
    const radarPlan = await buildPlan(db, NOW);
    assert.equal(radarPlan.eligible, 2);
    await updateConfig(db, {minValueTier: 'evidence_backed'}, 'owner');
    const strict = await buildPlan(db, NOW);
    assert.equal(strict.eligible, 0);
    assert.equal(strict.reasons.value_tier_below_minimum, 2);
    await updateConfig(db, {minValueTier: 'radar', allowSourceIds: []}, 'owner');
    const noSources = await buildPlan(db, NOW);
    assert.equal(noSources.eligible, 0);
    assert.equal(noSources.canArm, false);
    assert.ok(noSources.armBlockers.length > 0);
    assert.ok(noSources.armBlockers.join(' ').includes('Allowlist sumber'));
    await updateConfig(db, {allowSourceIds: ['00000000-0000-0000-0000-000000000000']}, 'owner');
    assert.equal((await buildPlan(db, NOW)).reasons.source_not_allowlisted, 2);
    await updateConfig(db, {allowSourceIds: [SRC]}, 'owner');
    const old = await buildPlan(db, NOW + 100 * 3600000);
    assert.equal(old.reasons.date_outside_window, 2);
  } finally { await db.close(); }
});

test('stage8 dry-run writes only its own audit row and produces a stable plan hash', async () => {
  const db = await fixture();
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar'}, 'owner');
    const before = (await db.execute('SELECT * FROM hub_items ORDER BY id')).rows;
    const out = await dryRun(db, 'owner', NOW);
    assert.equal(out.plan.eligible, 2);
    assert.match(out.plan.planHash, /^[a-f0-9]{64}$/);
    assert.equal(out.writes.outbox, 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
    assert.deepEqual((await db.execute('SELECT * FROM hub_items ORDER BY id')).rows, before);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_runs_v2')).rows[0].n), 1);
    const again = await dryRun(db, 'owner', NOW);
    assert.equal(again.plan.planHash, out.plan.planHash);
    assert.equal((await readConfig(db)).enabled, false, 'dry-run never arms');
  } finally { await db.close(); }
});

test('stage8 arm requires dry-run, matching hash, confirmation, and expires; config changes disarm', async () => {
  const db = await fixture();
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar'}, 'owner');
    const {plan} = await dryRun(db, 'owner', NOW);
    await assert.rejects(() => arm(db, plan.planHash, 'salah', 'owner', NOW), /CONFIRM_REQUIRED/);
    await assert.rejects(() => arm(db, 'b'.repeat(64), 'ARM AUTOPUBLISH', 'owner', NOW), /DRYRUN_REQUIRED/);
    await assert.rejects(() => arm(db, plan.planHash, 'ARM AUTOPUBLISH', 'owner', NOW + PUBLISH_POLICY.dryRunTtlMs + 1), /DRYRUN_EXPIRED/);
    const armed = await arm(db, plan.planHash, 'ARM AUTOPUBLISH', 'owner', NOW);
    assert.equal(armed.armed, true);
    assert.equal(armed.items, 2);
    const cfg = await readConfig(db);
    assert.equal(cfg.mode, 'live');
    assert.equal(cfg.enabled, true);
    assert.ok(Number(cfg.armedUntil) > NOW);
    await updateConfig(db, {dailyMax: 4}, 'owner');
    const after = await readConfig(db);
    assert.equal(after.enabled, false, 'config change disarms');
    assert.equal(after.mode, 'dry_run');
    assert.equal(after.armedPlanHash, null);
    await arm(db, plan.planHash, 'ARM AUTOPUBLISH', 'owner', NOW + 60000);
    await disarm(db, 'owner', NOW + 60000);
    assert.equal((await readConfig(db)).enabled, false);
    await assert.rejects(() => publishArmed(db, 'owner', okDeliver(), NOW + 60000), /NOT_ARMED/);
  } finally { await db.close(); }
});

test('stage8 publish is single-use, claims outbox rows, and auto-disarms', async () => {
  const db = await fixture();
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar'}, 'owner');
    const {plan} = await dryRun(db, 'owner', NOW);
    await arm(db, plan.planHash, 'ARM AUTOPUBLISH', 'owner', NOW);
    const counter = {calls: 0};
    const out = await publishArmed(db, 'owner', okDeliver(counter), NOW + 1000);
    assert.equal(counter.calls, 1);
    assert.equal(out.published, 2);
    assert.equal(out.claimed, 2);
    assert.equal(out.disarmed, true);
    const rows = (await db.execute('SELECT status,count(*) n FROM hub_publish_outbox GROUP BY status')).rows;
    assert.deepEqual(rows.map(r => [String(r.status), Number(r.n)]), [['published', 2]]);
    assert.equal((await readConfig(db)).enabled, false, 'single-use arm');
    await assert.rejects(() => publishArmed(db, 'owner', okDeliver(counter), NOW + 2000), /NOT_ARMED/);
    assert.equal(counter.calls, 1, 'no second delivery attempt');
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_items WHERE review_state=\'approved\'')).rows[0].n), 2);
  } finally { await db.close(); }
});

test('stage8 changed data after dry-run blocks publishing and forces a new dry-run', async () => {
  const db = await fixture();
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar'}, 'owner');
    const {plan} = await dryRun(db, 'owner', NOW);
    await arm(db, plan.planHash, 'ARM AUTOPUBLISH', 'owner', NOW);
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category,version,review_state,approved_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id(3), SRC, 'k3', 'https://satu.example.org/3', 'https://satu.example.org/3', 'Beasiswa ketiga Lombok', '2026-10-30T03:05:00Z', '2026-10-30', '2026-10-30', 'Beasiswa ketiga Lombok', 'Ringkasan editorial baru untuk berita ketiga.', 'Pendidikan', 1, 'approved', 1]});
    await prepareProfiles(db); await profileBatch(db, '');
    await prepareValues(db); await valueBatch(db, '');
    const counter = {calls: 0};
    await assert.rejects(() => publishArmed(db, 'owner', okDeliver(counter), NOW + 1000), /PLAN_CHANGED/);
    assert.equal(counter.calls, 0, 'nothing delivered');
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
    assert.equal((await readConfig(db)).enabled, false, 'disarmed for safety');
  } finally { await db.close(); }
});

test('stage8 delivery failure is recorded safely, refuses without credentials, and never retries alone', async () => {
  const db = await fixture();
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar'}, 'owner');
    const {plan} = await dryRun(db, 'owner', NOW);
    await arm(db, plan.planHash, 'ARM AUTOPUBLISH', 'owner', NOW);
    const failing = (async () => { throw Error('PUBLISH_HTTP_500'); }) as any;
    await assert.rejects(() => publishArmed(db, 'owner', failing, NOW + 1000), /PUBLISH_HTTP_500/);
    const failedRows = Number((await db.execute("SELECT count(*) n FROM hub_publish_outbox WHERE status='failed'")).rows[0].n);
    assert.equal(failedRows, 2);
    assert.equal((await readConfig(db)).enabled, false, 'disarmed after failure');

    // Tanpa kredensial backend, adapter bawaan menolak sebelum klaim apa pun.
    await db.execute("DELETE FROM hub_publish_outbox");
    const {plan: plan2} = await dryRun(db, 'owner', NOW + 5000);
    await arm(db, plan2.planHash, 'ARM AUTOPUBLISH', 'owner', NOW + 5000);
    await assert.rejects(() => publishArmed(db, 'owner', undefined as any, NOW + 6000), /NOT_CONFIGURED/);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
  } finally { await db.close(); }
});

test('stage8 delivery adapter maps articles, uses HTTPS REST with service key header, and flags duplicates', async () => {
  const snapshot = {editorialTitle: 'Beasiswa pelajar Lombok dibuka', editorialSummary: 'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar dan mahasiswa berprestasi melalui portal resmi.', originalUrl: 'https://satu.example.org/1', sourcePublishedAt: '2026-10-30T03:00:01Z', editorialCategory: 'Pendidikan'};
  const row = articleRow(snapshot);
  assert.ok(row && row.slug.includes('-hub-') && row.section === 'berita' && row.source_url === snapshot.originalUrl);
  const calls: {url: string; init: any}[] = [];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push({url, init});
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify(body.slice(0, 1).map((r: any) => ({id: 'uuid-1', source_url: r.source_url}))), {status: 201});
  }) as unknown as typeof fetch;
  const deliver = supabaseDeliver(fakeFetch, {HUB_WEBSITE_SUPABASE_URL: 'https://contoh.supabase.co', HUB_WEBSITE_SERVICE_ROLE_KEY: 'uji-key-tidak-nyata'} as any);
  const out = await deliver([{id: 'a', version: 1, snapshot}, {id: 'b', version: 1, snapshot: {...snapshot, originalUrl: 'https://satu.example.org/2'}}] as any);
  assert.equal(out.published.length, 1);
  assert.equal(out.duplicates.length, 1);
  assert.equal(calls[0].url, 'https://contoh.supabase.co/rest/v1/articles?on_conflict=source_url&select=id,source_url');
  assert.equal(calls[0].init.headers.apikey, 'uji-key-tidak-nyata');
  assert.ok(String(calls[0].init.headers.Prefer).includes('ignore-duplicates'));
  const unsafe = supabaseDeliver(fakeFetch, {HUB_WEBSITE_SUPABASE_URL: 'http://plain.example', HUB_WEBSITE_SERVICE_ROLE_KEY: 'x'} as any);
  await assert.rejects(() => unsafe([{id: 'a', version: 1, snapshot}] as any), /TARGET_INVALID/);
  const missing = supabaseDeliver(fakeFetch, {} as any);
  await assert.rejects(() => missing([{id: 'a', version: 1, snapshot}] as any), /NOT_CONFIGURED/);
});

test('stage8 API requires owner, CSRF, Preview webhub and explicit confirmations', async () => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const path = (await import('node:path')).default;
  const os = (await import('node:os')).default;
  const {setupOwner} = await import('../src/server/hub/security/auth');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hub-publish-api-')); const url = 'file:' + path.join(dir, 'p.db');
  const db = createClient({url});
  const keys = ['HUB_DATABASE_URL', 'HUB_ALLOW_LOCAL_DB', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'HUB_WEBSITE_SUPABASE_URL', 'HUB_WEBSITE_SERVICE_ROLE_KEY'], old = keys.map(k => process.env[k]);
  try {
    await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
    const user = await setupOwner(db, {token: 'test-setup-token-long-enough-not-real', password: 'publish-api-password-test'}, 'test-setup-token-long-enough-not-real');
    if (!user.ok) throw Error('fixture');
    delete process.env.HUB_WEBSITE_SUPABASE_URL; delete process.env.HUB_WEBSITE_SERVICE_ROLE_KEY;
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'webhub';
    const route = await import('../src/app/api/hub/publish/route');
    const origin = 'http://localhost:3100';
    const headers = {cookie: 'hub_session=' + user.session};
    const get = () => new Request(origin + '/api/hub/publish', {headers});
    const post = (body: unknown, csrf = true) => new Request(origin + '/api/hub/publish', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json', ...(csrf ? {origin, 'X-Hub-Request': '1'} : {})}, body: JSON.stringify(body)});

    assert.equal((await route.GET(new Request(origin + '/api/hub/publish'))).status, 401);
    const first = await (await route.GET(get())).json();
    assert.equal(first.status.ready, false);
    assert.equal(first.status.publicationEnabled, false);
    assert.equal(first.status.targetConfigured, false);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE AUTOPUBLISH'}, false))).status, 403);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'salah'}))).status, 400);
    assert.equal((await route.POST(post({action: 'dryRun', confirm: 'DRY RUN PUBLISH'}))).status, 409);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE AUTOPUBLISH'}))).status, 200);
    assert.equal((await route.POST(post({action: 'updateConfig', confirm: 'UPDATE PUBLISH CONFIG', allowSourceIds: ['not-a-uuid']}))).status, 409);
    const dry = await (await route.POST(post({action: 'dryRun', confirm: 'DRY RUN PUBLISH'}))).json();
    assert.equal(dry.plan.eligible, 0);
    assert.equal(dry.writes.outbox, 0);
    assert.equal((await route.POST(post({action: 'arm', confirm: 'ARM AUTOPUBLISH', planHash: dry.plan.planHash}))).status, 409);
    assert.equal((await route.POST(post({action: 'publish', confirm: 'PUBLISH NOW'}))).status, 409);
    assert.equal((await route.POST(post({action: 'disarm', confirm: 'DISARM AUTOPUBLISH'}))).status, 200);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
    process.env.VERCEL_ENV = 'production';
    assert.equal((await route.POST(post({action: 'dryRun', confirm: 'DRY RUN PUBLISH'}))).status, 403);
  } finally {
    db.close();
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    await rm(dir, {recursive: true, force: true});
  }
});

test('stage8 UI states the locks: dry-run first, single-use arm, no layout change', () => {
  const html = renderToStaticMarkup(React.createElement(AutopublishPanel, {}));
  assert.ok(html.includes('Autopublish ber-allowlist'));
  assert.ok(html.includes('dry-run'));
  assert.ok(html.includes('tidak mengubah beranda'));
  assert.ok(html.includes('izin sekali pakai') || html.includes('Siapkan tabel autopublish'));
});
