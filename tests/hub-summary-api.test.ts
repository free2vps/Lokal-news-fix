import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createClient} from '@libsql/client';
import {setupOwner} from '../src/server/hub/security/auth';

test('stage4 summaries API requires owner, CSRF, explicit confirmation and Preview webhub only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hub-summary-api-')), url = 'file:' + path.join(dir, 'test.db'), db = createClient({url});
  const keys = ['HUB_DATABASE_URL', 'HUB_ALLOW_LOCAL_DB', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'HUB_MASTER_KEY'], old = keys.map(k => process.env[k]);
  try {
    await db.executeMultiple(await readFile('db/hub-migrations/001_initial.sql', 'utf8'));
    const token = 'test-setup-token-long-enough-not-real';
    const user = await setupOwner(db, {token, password: 'summary-api-password-test'}, token);
    if (!user.ok) throw Error('fixture');
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'webhub';
    delete process.env.HUB_MASTER_KEY;
    const route = await import('../src/app/api/hub/summaries/route');
    const origin = 'http://localhost:3100';
    const headers = {cookie: 'hub_session=' + user.session};
    const get = (q = '') => new Request(origin + '/api/hub/summaries' + q, {headers});
    const post = (body: unknown, csrf = true) => new Request(origin + '/api/hub/summaries', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json', ...(csrf ? {origin, 'X-Hub-Request': '1'} : {})}, body: JSON.stringify(body)});

    assert.equal((await route.GET(new Request(origin + '/api/hub/summaries'))).status, 401);
    const first = await (await route.GET(get())).json();
    assert.equal(first.status.ready, false);
    assert.equal(first.publicationEnabled, false);
    assert.equal(first.ai.consent, false);
    assert.equal(first.plan.aiPending, 0);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE SUMMARIES'}, false))).status, 403);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'salah'}))).status, 400);
    assert.equal((await route.POST(post({action: 'batch', confirm: 'GENERATE SUMMARIES'}))).status, 409);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE SUMMARIES'}))).status, 200);
    assert.equal((await route.POST(post({action: 'batch'}))).status, 400);
    const batch = await (await route.POST(post({action: 'batch', confirm: 'GENERATE SUMMARIES'}))).json();
    assert.equal(batch.publicationEnabled, false);
    assert.equal(batch.processed, 0);
    assert.equal((await route.POST(post({action: 'apply', confirm: 'APPLY SUMMARY', id: "';DROP TABLE hub_items;--", version: 1}))).status, 400);
    assert.equal((await route.POST(post({action: 'apply', confirm: 'salah', id: 'legacy-news:00000000-0000-0000-0000-000000000001', version: 1}))).status, 400);
    const list = await (await route.GET(get('?view=list'))).json();
    assert.deepEqual(list.items, []);
    process.env.VERCEL_ENV = 'production';
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE SUMMARIES'}))).status, 403);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_admin_credentials')).rows[0].n), 1);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_items')).rows[0].n), 0);
  } finally {
    db.close();
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    await rm(dir, {recursive: true, force: true});
  }
});
