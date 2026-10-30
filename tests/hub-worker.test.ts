import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync} from 'node:fs';
import {
  prepareWorkerSchema, enqueueTask, tick, workerStatus, recoverExpiredTasks, issueWorkerToken, revokeWorkerToken,
  verifyWorkerToken, WORKER_POLICY, TASK_KINDS,
} from '../src/server/hub/domain/worker';
import {prepareValues} from '../src/server/hub/domain/editorial-value';
import {prepareProfiles} from '../src/server/hub/domain/content-profile';
import {prepareFeatures} from '../src/server/hub/domain/operations';
import {prepareSummarySchema} from '../src/server/hub/domain/ai-summary';

const NOW = Date.parse('2026-10-30T05:00:00Z');
const id = (n: number) => `legacy-news:00000000-0000-0000-0000-00000000000${n}`;
const THIN = 'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar dan mahasiswa berprestasi melalui portal resmi. Syarat pendaftaran belum dirinci seluruhnya...';

async function fixture() {
  const db = createClient({url: 'file::memory:'});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await db.execute("INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES('s','Media NTB','Provinsi','NTB','https://example.org','https://example.org','example.org','rss','metadata_only','2026-10-30','2026-10-30')");
  for (const n of [1, 2, 3]) {
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      args: [id(n), 's', 'k' + n, 'https://example.org/' + n, 'https://example.org/' + n, 'Beasiswa pelajar Lombok dibuka ' + n, THIN, '2026-10-30T02:00:00Z', '2026-10-30', '2026-10-30']});
  }
  await prepareFeatures(db);
  await prepareProfiles(db);
  await prepareValues(db);
  await prepareSummarySchema(db);
  await prepareWorkerSchema(db);
  return db;
}

test('stage7 worker schema, allowlisted kinds, payload validation, idempotency and queue cap', async () => {
  const db = await fixture();
  try {
    assert.deepEqual([...TASK_KINDS], ['profiles_batch', 'value_batch', 'summary_batch']);
    await assert.rejects(() => enqueueTask(db, {kind: 'publish_everything'}), /KIND_INVALID/);
    await assert.rejects(() => enqueueTask(db, {kind: 'value_batch', payload: {url: 'https://evil.example'}}), /PAYLOAD_INVALID/);
    const a = await enqueueTask(db, {kind: 'value_batch', idempotencyKey: 'value-run-2026-10-30'}, NOW);
    const b = await enqueueTask(db, {kind: 'value_batch', idempotencyKey: 'value-run-2026-10-30'}, NOW);
    assert.equal(a.id, b.id);
    assert.equal(b.deduplicated, true);
    const status = await workerStatus(db);
    assert.equal(status.queued, 1);
    assert.equal(status.publicationEnabled, false);
    assert.equal(status.cronConfigured, false);
    assert.equal(WORKER_POLICY.schedulerMode, 'manual_or_external');
    assert.equal((await db.execute('SELECT count(*) n FROM hub_worker_tasks_v2')).rows[0].n, 1);
  } finally { db.close(); }
});

test('stage7 tick claims one task, completes it, writes log and leaves news rows untouched', async () => {
  const db = await fixture();
  try {
    const before = (await db.execute('SELECT * FROM hub_items ORDER BY id')).rows;
    await enqueueTask(db, {kind: 'profiles_batch', idempotencyKey: 'profiles-batch-1'}, NOW);
    const out = await tick(db, {maxTasks: 1, now: NOW});
    assert.equal(out.publicationEnabled, false);
    assert.equal(out.results[0].claimed, true);
    assert.equal(out.results[0].status, 'done');
    assert.equal(out.results[0].count, 3);
    const after = await workerStatus(db);
    assert.equal(after.counts.done, 1);
    assert.equal(after.queued, 0);
    assert.ok(after.logs.some(l => l.status === 'DONE'));
    assert.equal(after.runner.active, false, 'runner lease is released after tick');
    assert.deepEqual((await db.execute('SELECT * FROM hub_items ORDER BY id')).rows, before);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
    const empty = await tick(db, {now: NOW});
    assert.equal(empty.results[0].reason, 'empty');
  } finally { db.close(); }
});

test('stage7 single runner: a held lease blocks a second worker without running tasks', async () => {
  const db = await fixture();
  try {
    await enqueueTask(db, {kind: 'value_batch', idempotencyKey: 'value-once'}, NOW);
    await db.execute({sql: "UPDATE hub_worker_state_v2 SET lease_owner='other-worker',lease_until=? WHERE id='runner'", args: [NOW + 30000]});
    const blocked = await tick(db, {maxTasks: 1, now: NOW});
    assert.equal(blocked.results[0].claimed, false);
    assert.equal(blocked.results[0].reason, 'runner_busy');
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_editorial_value_v2')).rows[0].n), 0);
    const later = await tick(db, {maxTasks: 1, now: NOW + 30001});
    assert.equal(later.results[0].status, 'done');
  } finally { db.close(); }
});

test('stage7 failures retry with backoff, then become dead letters instead of looping forever', async () => {
  const db = await fixture();
  try {
    // Tanpa izin provider AI, tugas ringkasan gagal dengan kode terkendali.
    const task = await enqueueTask(db, {kind: 'summary_batch', idempotencyKey: 'summary-no-consent'}, NOW);
    const first = await tick(db, {maxTasks: 1, now: NOW});
    assert.equal(first.results[0].status, 'failed');
    assert.equal(first.results[0].error, 'WORKER_QUOTA_OR_PROVIDER');
    assert.ok(first.results[0].nextRunAt > NOW);
    const row = (await db.execute({sql: 'SELECT status,attempts,next_run_at FROM hub_worker_tasks_v2 WHERE id=?', args: [task.id]})).rows[0];
    assert.equal(String(row.status), 'failed');
    assert.equal(Number(row.attempts), 1);
    const tooEarly = await tick(db, {maxTasks: 1, now: NOW + 1000});
    assert.equal(tooEarly.results[0].reason, 'empty', 'backoff delay is respected');
    await db.execute({sql: 'UPDATE hub_worker_tasks_v2 SET attempts=3,next_run_at=0 WHERE id=?', args: [task.id]});
    const dead = await tick(db, {maxTasks: 1, now: NOW + 5000});
    assert.equal(dead.results[0].status, 'dead');
    const status = await workerStatus(db);
    assert.equal(status.dead, 1);
    assert.equal(status.deadLetters[0].error, 'WORKER_QUOTA_OR_PROVIDER');
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_ai_summaries_v2')).rows[0].n), 0);
  } finally { db.close(); }
});

test('stage7 expired leases are recovered rather than stuck, and repeated expiry can dead-letter', async () => {
  const db = await fixture();
  try {
    const t = await enqueueTask(db, {kind: 'value_batch', idempotencyKey: 'lease-test'}, NOW);
    await db.execute({sql: "UPDATE hub_worker_tasks_v2 SET status='leased',lease_owner='gone',lease_until=?,attempts=1 WHERE id=?", args: [NOW - 1000, t.id]});
    const rec = await recoverExpiredTasks(db, NOW);
    assert.equal(rec.recovered, 1);
    const row = (await db.execute({sql: 'SELECT status,last_error,lease_owner FROM hub_worker_tasks_v2 WHERE id=?', args: [t.id]})).rows[0];
    assert.equal(String(row.status), 'queued');
    assert.equal(String(row.last_error), 'LEASE_EXPIRED');
    assert.equal(row.lease_owner, null);
    await db.execute({sql: "UPDATE hub_worker_tasks_v2 SET status='leased',lease_until=?,attempts=3 WHERE id=?", args: [NOW - 1000, t.id]});
    await recoverExpiredTasks(db, NOW);
    assert.equal(String((await db.execute({sql: 'SELECT status FROM hub_worker_tasks_v2 WHERE id=?', args: [t.id]})).rows[0].status), 'dead');
  } finally { db.close(); }
});

test('stage7 worker tokens are hashed, verifiable, revocable and never stored in plaintext', async () => {
  const db = await fixture();
  try {
    const issued = await issueWorkerToken(db, 'cron eksternal', NOW);
    assert.match(issued.token, /^[0-9a-f]{64}$/);
    const stored = (await db.execute('SELECT token_hash,label FROM hub_worker_tokens_v2')).rows[0];
    assert.notEqual(String(stored.token_hash), issued.token);
    assert.equal(String(stored.label), 'cron eksternal');
    assert.equal(await verifyWorkerToken(db, 'Bearer ' + issued.token, NOW), true);
    assert.equal(await verifyWorkerToken(db, 'Bearer ' + 'a'.repeat(64), NOW), false);
    assert.equal(await verifyWorkerToken(db, null, NOW), false);
    assert.equal(await verifyWorkerToken(db, 'Basic abc', NOW), false);
    const tokenRow = (await db.execute('SELECT id FROM hub_worker_tokens_v2')).rows[0];
    await revokeWorkerToken(db, String(tokenRow.id), NOW);
    assert.equal(await verifyWorkerToken(db, 'Bearer ' + issued.token, NOW), false);
    await assert.rejects(() => revokeWorkerToken(db, 'not-a-uuid'), /TOKEN_INVALID/);
  } finally { db.close(); }
});

test('stage7 tick with token runs only pre-enqueued work and API rejects unauthenticated calls', async () => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const path = (await import('node:path')).default;
  const os = (await import('node:os')).default;
  const {setupOwner} = await import('../src/server/hub/security/auth');
  const {getHubDb} = await import('../src/server/hub/db/client');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hub-worker-api-')); const url = 'file:' + path.join(dir, 'w.db');
  const db = createClient({url});
  const keys = ['HUB_DATABASE_URL', 'HUB_ALLOW_LOCAL_DB', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF'], old = keys.map(k => process.env[k]);
  try {
    await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
    const user = await setupOwner(db, {token: 'test-setup-token-long-enough-not-real', password: 'worker-api-password-test'}, 'test-setup-token-long-enough-not-real');
    if (!user.ok) throw Error('fixture');
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'webhub';
    await prepareValues(db);
    await db.execute("INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES('s','Media NTB','Provinsi','NTB','https://example.org','https://example.org','example.org','rss','metadata_only','2026-10-30','2026-10-30')");
    await db.execute("INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_published_at,first_seen_at,last_seen_at) VALUES('legacy-news:00000000-0000-0000-0000-000000000001','s','k1','https://example.org/1','https://example.org/1','Beasiswa Lombok dibuka','2026-10-30T02:00:00Z','2026-10-30','2026-10-30')");
    const route = await import('../src/app/api/hub/worker/route');
    const origin = 'http://localhost:3100';
    const headers = {cookie: 'hub_session=' + user.session};
    const post = (body: unknown, csrf = true) => new Request(origin + '/api/hub/worker', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json', ...(csrf ? {origin, 'X-Hub-Request': '1'} : {})}, body: JSON.stringify(body)});

    assert.equal((await route.GET(new Request(origin + '/api/hub/worker'))).status, 401);
    const before = await (await route.GET(new Request(origin + '/api/hub/worker', {headers}))).json();
    assert.equal(before.ready, false);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE WORKER'}, false))).status, 403);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'salah'}))).status, 400);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE WORKER'}))).status, 200);
    assert.equal((await route.POST(post({action: 'enqueue', confirm: 'ENQUEUE WORKER', kind: 'publish_now'}))).status, 409);
    assert.equal((await route.POST(post({action: 'enqueue', confirm: 'ENQUEUE WORKER', kind: 'summary_batch'}))).status, 409, 'prerequisite table must exist');
    assert.equal((await route.POST(post({action: 'tick', confirm: 'salah'}))).status, 400);

    // Tanpa token: tick anonim ditolak; dengan token: berjalan tanpa sesi dan tanpa CSRF.
    const anon = await route.POST(new Request(origin + '/api/hub/worker?action=tick', {method: 'POST', headers: {authorization: 'Bearer ' + 'b'.repeat(64)}}));
    assert.equal(anon.status, 401);
    const issued = await (await route.POST(post({action: 'issueToken', confirm: 'ISSUE WORKER TOKEN', label: 'uji'}))).json();
    const enq = await (await route.POST(post({action: 'enqueue', confirm: 'ENQUEUE WORKER', kind: 'value_batch'}))).json();
    assert.equal(enq.status.queued, 1);
    const ticked = await route.POST(new Request(origin + '/api/hub/worker?action=tick', {method: 'POST', headers: {authorization: 'Bearer ' + issued.token}}));
    assert.equal(ticked.status, 200);
    const out = await ticked.json();
    assert.equal(out.publicationEnabled, false);
    assert.equal(out.results[0].status, 'done');
    assert.equal(getHubDb().constructor.name.length > 0, true);
    process.env.VERCEL_ENV = 'production';
    assert.equal((await route.POST(new Request(origin + '/api/hub/worker?action=tick', {method: 'POST', headers: {authorization: 'Bearer ' + issued.token}}))).status, 403);
  } finally {
    db.close();
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    await rm(dir, {recursive: true, force: true});
  }
});
