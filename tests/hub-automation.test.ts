import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareFeatures} from '../src/server/hub/domain/operations';
import {prepareProfiles, profileBatch} from '../src/server/hub/domain/content-profile';
import {prepareValues, valueBatch} from '../src/server/hub/domain/editorial-value';
import {prepareSummarySchema} from '../src/server/hub/domain/ai-summary';
import {preparePublishSchema, updateConfig, setSchedule, publishScheduled, readConfig, PUBLISH_POLICY} from '../src/server/hub/domain/publish-policy';
import {prepareSocialSchema, socialStatus, issueSocialToken, claimBatch} from '../src/server/hub/domain/social-pull';
import {
  prepareAutomationSchema, runAutomation, automationStatus, issueAutomationToken, revokeAutomationToken,
  verifyAutomationToken, AUTOMATION_POLICY,
} from '../src/server/hub/domain/automation';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const SRC = '22222222-2222-2222-2222-222222222222';
const id = (n: number) => `legacy-news:00000000-0000-0000-0000-00000000000${n}`;

async function fixture(opts: {approved?: number; pending?: number} = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-'));
  const db = createClient({url: 'file:' + path.join(dir, 'auto.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute({sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES(?,'Media NTB','Provinsi','NTB','https://satu.example.org','https://satu.example.org','satu.example.org','rss','permission_confirmed','2026-10-30','2026-10-30')", args: [SRC]});
  const approved = opts.approved ?? 5, pending = opts.pending ?? 2;
  for (let i = 1; i <= approved + pending; i++) {
    const isApproved = i <= approved;
    const publishedAt = new Date(NOW - i * 30 * 60000).toISOString();
    const summary = `Ringkasan editorial berita ${i} tentang layanan publik di Nusa Tenggara Barat.`;
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category,version,review_state,approved_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id(i), SRC, 'k' + i, 'https://satu.example.org/' + i, 'https://satu.example.org/' + i, 'Beasiswa pelajar Lombok dibuka ' + i,
        'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar dan mahasiswa berprestasi melalui portal resmi.',
        publishedAt, '2026-10-30', '2026-10-30', isApproved ? 'Beasiswa pelajar Lombok dibuka ' + i : null, isApproved ? summary : null, isApproved ? 'Pendidikan' : null, 1,
        isApproved ? 'approved' : 'pending_review', isApproved ? 1 : null]});
    if (isApproved) {
      const snap = JSON.stringify({id: id(i), sourceId: SRC, originalUrl: 'https://satu.example.org/' + i, sourceTitle: 'Beasiswa pelajar Lombok dibuka ' + i, sourceSnippet: 'Snippet', sourcePublishedAt: publishedAt, editorialTitle: 'Beasiswa pelajar Lombok dibuka ' + i, editorialSummary: summary, editorialCategory: 'Pendidikan', version: 1});
      await db.execute({sql: 'INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES(?,1,?,?,?)', args: [id(i), snap, '2026-10-30T09:00:00Z', 'owner']});
    }
  }
  await prepareFeatures(db);
  await prepareProfiles(db); await profileBatch(db, '');
  await prepareValues(db); await valueBatch(db, '');
  await prepareSummarySchema(db);
  await preparePublishSchema(db);
  await prepareAutomationSchema(db);
  const close = db.close.bind(db);
  (db as any).close = async (...args: any[]) => { await (close as any)(...args); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return db;
}

const okDeliver = (counter = {calls: 0, items: [] as string[]}) => (async (items: any[]) => {
  counter.calls += 1; counter.items.push(...items.map(i => i.id));
  return {published: items.map(i => i.id), duplicates: [], failed: [], target: 'fake'};
}) as any;

test('stage9 automation runs the pipeline, never approves news, and reports each step', async () => {
  const db = await fixture({approved: 0, pending: 3});
  try {
    const before = (await db.execute('SELECT * FROM hub_items ORDER BY id')).rows;
    const out = await runAutomation(db, {now: NOW, trigger: 'test'});
    assert.equal(out.intervalHours, 3);
    assert.equal(out.approvalRemainsHuman, true);
    assert.ok(out.steps.length >= 6);
    const names = out.steps.map(s => s.step);
    for (const step of ['rss', 'profiles', 'values', 'summaries', 'social_queue', 'publish']) assert.ok(names.includes(step), `missing ${step}`);
    assert.equal(Number((await db.execute("SELECT count(*) n FROM hub_items WHERE review_state='approved'")).rows[0].n), 0, 'tidak ada persetujuan otomatis');
    assert.deepEqual((await db.execute('SELECT review_state FROM hub_items ORDER BY id')).rows, before.map(r => ({review_state: r.review_state})));
    const status = await automationStatus(db);
    assert.equal(status.runs.length, 1);
    assert.equal(status.runs[0].trigger, 'test');
    assert.equal(status.intervalHours, 3);
    assert.equal(AUTOMATION_POLICY.summariesPerRun, 2);
  } finally { await db.close(); }
});

test('stage9 pipeline is tolerant: missing optional tables are reported, not fatal', async () => {
  const db = await fixture({approved: 0, pending: 1});
  try {
    await db.execute('DROP TABLE hub_editorial_value_v2');
    const out = await runAutomation(db, {now: NOW, trigger: 'test'});
    const values = out.steps.find(s => s.step === 'values');
    assert.equal(values?.ok, false);
    assert.ok(out.steps.some(s => s.step === 'profiles' && s.ok));
    assert.ok(['ok', 'partial'].includes(out.status));
  } finally { await db.close(); }
});

test('stage9 scheduled publish stays off by default and requires allowlist before enabling', async () => {
  const db = await fixture();
  try {
    const cfg = await readConfig(db);
    assert.equal(cfg.scheduleEnabled, false);
    assert.equal(cfg.maxPerRun, 4);
    await assert.rejects(() => setSchedule(db, true, 'ENABLE SCHEDULE 3H', 'owner', NOW), /ALLOWLIST_EMPTY/);
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar', dailyMax: 10}, 'owner');
    await assert.rejects(() => setSchedule(db, true, 'salah', 'owner', NOW), /CONFIRM_REQUIRED/);
    const on = await setSchedule(db, true, 'ENABLE SCHEDULE 3H', 'owner', NOW);
    assert.equal(on.scheduleEnabled, true);
    assert.equal(on.maxPerRun, 4);
    const enabled = await publishScheduled(db, 'owner', okDeliver(), NOW);
    assert.notEqual(enabled.reason, 'schedule_disabled', 'jadwal aktif tidak dilewati karena saklar');
    assert.ok(enabled.published <= 4);
    await setSchedule(db, false, 'x', 'owner', NOW);
    const off = await publishScheduled(db, 'owner', okDeliver(), NOW);
    assert.equal(off.skipped, true);
    assert.equal(off.reason, 'schedule_disabled');
    // Perubahan konfigurasi juga mematikan jadwal.
    await setSchedule(db, true, 'ENABLE SCHEDULE 3H', 'owner', NOW);
    await updateConfig(db, {dailyMax: 9}, 'owner');
    assert.equal((await readConfig(db)).scheduleEnabled, false);
  } finally { await db.close(); }
});

test('stage9 scheduled publish sends at most 4 approved articles per run and needs approval snapshots', async () => {
  const db = await fixture({approved: 6, pending: 2});
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar', dailyMax: 20}, 'owner');
    await setSchedule(db, true, 'ENABLE SCHEDULE 3H', 'owner', NOW);
    const counter = {calls: 0, items: [] as string[]};
    const out = await publishScheduled(db, 'owner', okDeliver(counter), NOW);
    assert.equal(out.published, 4);
    assert.equal(out.maxPerRun, 4);
    assert.equal(counter.items.length, 4);
    const published = (await db.execute("SELECT item_id FROM hub_publish_outbox WHERE status='published'")).rows.map(r => String(r.item_id));
    assert.equal(published.length, 4);
    assert.ok(!published.includes(id(6)), 'berita ke-6 tetap menunggu putaran berikutnya');
    // Putaran berikutnya mengambil sisanya, bukan mengulang yang sudah terbit.
    const second = await publishScheduled(db, 'owner', okDeliver(counter), NOW + 1000);
    assert.equal(second.published, 2);
    const third = await publishScheduled(db, 'owner', okDeliver(counter), NOW + 2000);
    assert.equal(third.skipped, true);
    assert.equal(third.reason, 'no_eligible');
    assert.equal(Number((await db.execute("SELECT count(*) n FROM hub_items WHERE review_state='pending_review'")).rows[0].n), 2, 'berita belum disetujui tidak ikut terbit');
  } finally { await db.close(); }
});

test('stage9 one trigger does both: pipeline publishes and the same run fills the social queue', async () => {
  const db = await fixture({approved: 3, pending: 1});
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar', dailyMax: 20}, 'owner');
    await setSchedule(db, true, 'ENABLE SCHEDULE 3H', 'owner', NOW);
    await issueSocialToken(db, 'make', NOW);
    const counter = {calls: 0, items: [] as string[]};
    const out = await runAutomation(db, {now: NOW, trigger: 'scheduler', deliver: okDeliver(counter)});
    assert.equal(out.approvalRemainsHuman, true);
    const publishStep = out.steps.find(s => s.step === 'publish');
    assert.equal(publishStep?.ok, true);
    assert.equal(publishStep?.count, 3);
    // Urutan langkah: penerbitan sebelum antrean, sehingga trigger yang sama langsung bisa menarik.
    const order = out.steps.map(s => s.step);
    assert.ok(order.indexOf('publish') < order.indexOf('social_queue'), 'terbit dulu, antrean sesudahnya');
    const queueStep = out.steps.find(s => s.step === 'social_queue');
    assert.equal(queueStep?.count, 3, 'artikel yang baru terbit pada putaran ini masuk antrean');
    const social = await socialStatus(db);
    assert.equal(social.pending, 3);
    // Make menarik dengan pemicu yang sama (satu skenario, tanpa perlu menunggu 3 jam berikutnya).
    const pulled = await claimBatch(db, {max: 4, now: NOW + 1000, env: {}} as any);
    assert.equal(pulled.count, 3);
    assert.equal(pulled.limit, 4);
    assert.equal(Number((await db.execute("SELECT count(*) n FROM hub_publish_outbox WHERE status='published'")).rows[0].n), 3);
    assert.equal(PUBLISH_POLICY.schedulerConfigured, false, 'cron hosting tetap tidak diubah');
  } finally { await db.close(); }
});

test('stage9 pipeline still fills the queue after publishing on a later run when publishing was off', async () => {
  const db = await fixture({approved: 2, pending: 0});
  try {
    await updateConfig(db, {allowSourceIds: [SRC], allowRegions: ['NTB'], minValueTier: 'radar', dailyMax: 20}, 'owner');
    const off = await runAutomation(db, {now: NOW, trigger: 'scheduler', deliver: okDeliver()});
    assert.equal(off.steps.find(s => s.step === 'publish')?.count, 0);
    assert.equal((await socialStatus(db)).pending, 0, 'tanpa penerbitan tidak ada yang masuk antrean');
    await setSchedule(db, true, 'ENABLE SCHEDULE 3H', 'owner', NOW);
    const on = await runAutomation(db, {now: NOW + 1000, trigger: 'scheduler', deliver: okDeliver()});
    assert.equal(on.steps.find(s => s.step === 'social_queue')?.count, 2);
    assert.equal((await socialStatus(db)).pending, 2);
  } finally { await db.close(); }
});

test('stage9 automation tokens are hashed, scoped to run, revocable', async () => {
  const db = await fixture({approved: 0, pending: 1});
  try {
    const issued = await issueAutomationToken(db, 'cron 3 jam', NOW);
    assert.match(issued.token, /^[0-9a-f]{64}$/);
    assert.notEqual(String((await db.execute('SELECT token_hash FROM hub_automation_tokens_v2')).rows[0].token_hash), issued.token);
    assert.equal(await verifyAutomationToken(db, 'Bearer ' + issued.token, NOW), true);
    assert.equal(await verifyAutomationToken(db, 'Bearer ' + '0'.repeat(64), NOW), false);
    assert.equal(await verifyAutomationToken(db, 'Bearer short', NOW), false);
    const tid = String((await db.execute('SELECT id FROM hub_automation_tokens_v2')).rows[0].id);
    await revokeAutomationToken(db, tid, NOW);
    assert.equal(await verifyAutomationToken(db, 'Bearer ' + issued.token, NOW), false);
  } finally { await db.close(); }
});

test('stage9 automation API: owner+CSRF for admin, bearer token only for scheduler, Preview only', async () => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const pathMod = (await import('node:path')).default;
  const osMod = (await import('node:os')).default;
  const {setupOwner} = await import('../src/server/hub/security/auth');
  const dir = await mkdtemp(pathMod.join(osMod.tmpdir(), 'auto-api-')); const url = 'file:' + pathMod.join(dir, 'auto.db');
  const db = createClient({url});
  const keys = ['HUB_DATABASE_URL', 'HUB_ALLOW_LOCAL_DB', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF'], old = keys.map(k => process.env[k]);
  try {
    await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
    const user = await setupOwner(db, {token: 'test-setup-token-long-enough-not-real', password: 'auto-api-password-test'}, 'test-setup-token-long-enough-not-real');
    if (!user.ok) throw Error('fixture');
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'webhub';
    const route = await import('../src/app/api/hub/automation/route');
    const origin = 'http://localhost:3100';
    const headers = {cookie: 'hub_session=' + user.session};
    const post = (body: unknown, csrf = true) => new Request(origin + '/api/hub/automation', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json', ...(csrf ? {origin, 'X-Hub-Request': '1'} : {})}, body: JSON.stringify(body)});

    assert.equal((await route.GET(new Request(origin + '/api/hub/automation'))).status, 401);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE AUTOMATION'}, false))).status, 403);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'salah'}))).status, 400);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE AUTOMATION'}))).status, 200);
    const issued = await (await route.POST(post({action: 'issueToken', confirm: 'ISSUE AUTOMATION TOKEN', label: '3 jam'}))).json();
    const anon = await route.POST(new Request(origin + '/api/hub/automation?action=run', {method: 'POST', headers: {authorization: 'Bearer ' + 'd'.repeat(64)}}));
    assert.equal(anon.status, 401);
    const run = await route.POST(new Request(origin + '/api/hub/automation?action=run', {method: 'POST', headers: {authorization: 'Bearer ' + issued.token}}));
    assert.equal(run.status, 200);
    const body = await run.json();
    assert.equal(body.intervalHours, 3);
    assert.equal(body.approvalRemainsHuman, true);
    assert.ok(Array.isArray(body.steps));
    process.env.VERCEL_ENV = 'production';
    assert.equal((await route.POST(new Request(origin + '/api/hub/automation?action=run', {method: 'POST', headers: {authorization: 'Bearer ' + issued.token}}))).status, 403);
  } finally {
    db.close();
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    await rm(dir, {recursive: true, force: true});
  }
});
