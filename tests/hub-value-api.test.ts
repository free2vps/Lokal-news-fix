import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createClient} from '@libsql/client';
import {setupOwner} from '../src/server/hub/security/auth';

test('stage5 value API requires owner, CSRF, confirmation, Preview webhub; read-only otherwise', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hub-value-api-')), url = 'file:' + path.join(dir, 'test.db'), db = createClient({url});
  const keys = ['HUB_DATABASE_URL', 'HUB_ALLOW_LOCAL_DB', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF'], old = keys.map(k => process.env[k]);
  try {
    await db.executeMultiple(await readFile('db/hub-migrations/001_initial.sql', 'utf8'));
    const token = 'test-setup-token-long-enough-not-real';
    const user = await setupOwner(db, {token, password: 'value-api-password-test'}, token);
    if (!user.ok) throw Error('fixture');
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'webhub';
    const route = await import('../src/app/api/hub/value/route');
    const origin = 'http://localhost:3100';
    const headers = {cookie: 'hub_session=' + user.session};
    const get = (q = '') => new Request(origin + '/api/hub/value' + q, {headers});
    const post = (body: unknown, csrf = true) => new Request(origin + '/api/hub/value', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json', ...(csrf ? {origin, 'X-Hub-Request': '1'} : {})}, body: JSON.stringify(body)});

    assert.equal((await route.GET(new Request(origin + '/api/hub/value'))).status, 401);
    const first = await (await route.GET(get())).json();
    assert.equal(first.status.ready, false);
    assert.equal(first.publicationEnabled, false);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE VALUES'}, false))).status, 403);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'salah'}))).status, 400);
    assert.equal((await route.POST(post({action: 'batch'}))).status, 409);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE VALUES'}))).status, 200);
    assert.equal((await route.POST(post({action: 'batch', cursor: "';DROP TABLE hub_items;--"}))).status, 400);
    assert.equal((await route.GET(get('?id=bukan-uuid'))).status, 400);
    const batch = await (await route.POST(post({action: 'batch'}))).json();
    assert.equal(batch.processed, 0);
    assert.equal((await route.GET(get('?id=legacy-news:00000000-0000-0000-0000-000000000001'))).status, 200);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_items')).rows[0].n), 0);
    process.env.VERCEL_ENV = 'production';
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE VALUES'}))).status, 403);
    assert.equal((await route.GET(get())).status, 200, 'read-only status stays available to owner');
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_admin_credentials')).rows[0].n), 1);
  } finally {
    db.close();
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    await rm(dir, {recursive: true, force: true});
  }
});
