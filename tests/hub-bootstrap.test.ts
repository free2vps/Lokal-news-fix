import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from '@libsql/client';
import { bootstrapEmptyDatabase, bootstrapTargetMatches, canBootstrapPreview, handlePreviewBootstrap } from '../src/server/hub/db/bootstrap';
import { setupOwner, isConfigured } from '../src/server/hub/security/auth';
import { governmentManifest, normalizeSourceUrl, governmentDomain } from '../src/server/hub/domain/sources';
import { getHubDb } from '../src/server/hub/db/client';

const secret = randomBytes(32).toString('base64url');
const env = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'webhub', HUB_BOOTSTRAP_ALLOW: 'true', HUB_SETUP_TOKEN: secret,
  HUB_BOOTSTRAP_EXPECTED_DATABASE: 'database-amber-blanket', HUB_DATABASE_URL: 'libsql://database-amber-blanket-example.turso.io' };
const origin = 'https://preview.example.test';
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + '/api/hub/bootstrap', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-hub-request': '1', ...headers }, body: JSON.stringify(body) });
}
const valid = { token: secret, confirm: 'SIAPKAN DATABASE PREVIEW' };

test('bootstrap requires explicit enablement on the exact Vercel webhub Preview', () => {
  assert.equal(canBootstrapPreview(env), true);
  for (const [key, value] of Object.entries({ VERCEL: '0', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'other-branch', HUB_BOOTSTRAP_ALLOW: 'false' })) {
    assert.equal(canBootstrapPreview({ ...env, [key]: value }), false, key);
    const missing: Record<string, string | undefined> = { ...env }; delete missing[key];
    assert.equal(canBootstrapPreview(missing), false, key + ' missing');
  }
});

test('bootstrap target is the expected Turso database and never a private or unrelated host', () => {
  assert.equal(bootstrapTargetMatches(env), true);
  for (const url of [
    'libsql://different-db-example.turso.io',
    'https://database-amber-blanket-example.turso.io.evil.test',
    'https://127.0.0.1',
    'https://169.254.169.254/latest',
    'http://database-amber-blanket-example.turso.io',
    'libsql://database-amber-blanket-example.turso.io?authToken=x',
    'libsql://name:pass@database-amber-blanket-example.turso.io',
    'libsql://database-amber-blanket-example.turso.io:8443',
    'libsql://database-amber-blanket-example.turso.io/a-path',
    'file:test.db',
  ]) assert.equal(bootstrapTargetMatches({ ...env, HUB_DATABASE_URL: url }), false, url);
  assert.equal(bootstrapTargetMatches({ ...env, HUB_BOOTSTRAP_EXPECTED_DATABASE: 'other-db' }), false);
  assert.equal(bootstrapTargetMatches({ ...env, HUB_BOOTSTRAP_EXPECTED_DATABASE: '' }), false);
});

test('configured Preview guard blocks even normal Hub DB access to an unintended host', () => {
  const keys = ['HUB_DATABASE_URL', 'HUB_DATABASE_AUTH_TOKEN', 'HUB_BOOTSTRAP_ALLOW', 'HUB_BOOTSTRAP_EXPECTED_DATABASE'] as const;
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    process.env.HUB_DATABASE_URL = 'https://169.254.169.254';
    process.env.HUB_DATABASE_AUTH_TOKEN = 'fixture-never-sent';
    process.env.HUB_BOOTSTRAP_ALLOW = 'true';
    process.env.HUB_BOOTSTRAP_EXPECTED_DATABASE = 'database-amber-blanket';
    assert.throws(() => getHubDb(), /HUB_DB_TARGET_MISMATCH/);
    delete process.env.HUB_BOOTSTRAP_EXPECTED_DATABASE;
    assert.throws(() => getHubDb(), /HUB_DB_TARGET_MISMATCH/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('protected bootstrap rejects wrong scope, origin, token, target and confirmation without touching database', async () => {
  let calls = 0;
  const db = createClient({ url: 'file::memory:' });
  const getDb = () => { calls++; return db; };
  try {
    assert.equal((await handlePreviewBootstrap(request(valid), { env: { ...env, VERCEL_ENV: 'production' }, getDb })).status, 404);
    assert.equal((await handlePreviewBootstrap(request(valid, { origin: 'https://attacker.test' }), { env, getDb })).status, 403);
    assert.equal((await handlePreviewBootstrap(request(valid), { env: { ...env, HUB_SETUP_TOKEN: 'x'.repeat(32) }, getDb })).status, 503);
    assert.equal((await handlePreviewBootstrap(request({ ...valid, token: randomBytes(32).toString('base64url') }), { env, getDb })).status, 401);
    assert.equal((await handlePreviewBootstrap(request({ token: secret }), { env, getDb })).status, 400);
    assert.equal((await handlePreviewBootstrap(request({ ...valid, token: 'a'.repeat(20000) }), { env, getDb })).status, 400);
    assert.equal((await handlePreviewBootstrap(request(valid), { env: { ...env, HUB_DATABASE_URL: 'https://169.254.169.254' }, getDb })).status, 503);
    assert.equal((await handlePreviewBootstrap(request(valid), { env: { ...env, HUB_BOOTSTRAP_EXPECTED_DATABASE: 'another-db' }, getDb })).status, 503);
    assert.equal(calls, 0);
    assert.equal((await db.execute("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")).rows.length, 0);
  } finally { db.close(); }
});

test('empty database receives exactly 11 inactive sources; retry and edited records are untouched', async () => {
  const db = createClient({ url: 'file::memory:' });
  try {
    const response = await handlePreviewBootstrap(request(valid), { env, getDb: () => db });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true, sources: 11, active: 0 });
    const stats = (await db.execute(`SELECT
      (SELECT count(*) FROM hub_sources) sources,
      (SELECT count(*) FROM hub_sources WHERE is_active=1 OR discovered_type!='unverified' OR rights_status!='unknown') active,
      (SELECT count(*) FROM hub_admin_credentials) owners,
      (SELECT count(*) FROM hub_items) items`)).rows[0];
    assert.equal(Number(stats.sources), 11); assert.equal(Number(stats.active), 0);
    assert.equal(Number(stats.owners), 0); assert.equal(Number(stats.items), 0);
    for (const source of governmentManifest()) {
      const row = (await db.execute({ sql: 'SELECT name,requested_url,normalized_url,publisher_domain FROM hub_sources WHERE id=?', args: [source.id] })).rows[0];
      assert.ok(row); assert.equal(row.name, source.name); assert.equal(row.requested_url, source.requestedUrl);
      assert.equal(row.normalized_url, normalizeSourceUrl(source.requestedUrl));
      assert.equal(row.publisher_domain, governmentDomain(source.requestedUrl));
    }
    assert.equal(await isConfigured(db), false);
    await db.execute("UPDATE hub_sources SET name='Nama manual harus tetap' WHERE id='gov-ntb-dompu'");
    assert.equal((await handlePreviewBootstrap(request(valid), { env, getDb: () => db })).status, 409);
    assert.equal((await db.execute("SELECT name FROM hub_sources WHERE id='gov-ntb-dompu'")).rows[0].name, 'Nama manual harus tetap');
    const owner = await setupOwner(db, { token: secret, password: 'fixture-password-that-is-not-real' }, secret);
    assert.equal(owner.ok, true);
    assert.equal(await isConfigured(db), true);
  } finally { db.close(); }
});

test('database containing any unrelated object is never modified', async () => {
  const db = createClient({ url: 'file::memory:' });
  try {
    await db.execute('CREATE TABLE old_data (id INTEGER PRIMARY KEY, value TEXT)');
    await db.execute("INSERT INTO old_data(value) VALUES ('keep me')");
    assert.equal(await bootstrapEmptyDatabase(db), 'not_empty');
    assert.equal((await db.execute('SELECT value FROM old_data')).rows[0].value, 'keep me');
    assert.equal((await db.execute("SELECT name FROM sqlite_schema WHERE name='hub_sources'")).rows.length, 0);
  } finally { db.close(); }
});

test('partial failure rolls back all schema changes', async () => {
  const db = createClient({ url: 'file::memory:' });
  // Exercise the real write transaction but substitute a failing migration.
  const faulty = new Proxy(db, { get(target, property, receiver) {
    if (property !== 'transaction') return Reflect.get(target, property, receiver);
    return async () => {
      const tx = await target.transaction('write');
      return new Proxy(tx, { get(inner, key, innerReceiver) {
        if (key === 'executeMultiple') return async (sql: string) => inner.executeMultiple(sql + '\nINSERT INTO definitely_missing_table VALUES (1);');
        const value = Reflect.get(inner, key, inner);
        return typeof value === 'function' ? value.bind(inner) : value;
      } });
    };
  } });
  try {
    await assert.rejects(() => bootstrapEmptyDatabase(faulty), /definitely_missing_table/);
    assert.equal((await db.execute("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")).rows.length, 0);
  } finally { db.close(); }
});
