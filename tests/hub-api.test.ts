import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '@libsql/client';
import { setupOwner } from '../src/server/hub/security/auth';
import { seedGovernmentSources } from '../src/server/hub/domain/sources';

test('source API requires session and CSRF; adds only inactive unverified sources', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hub-api-test-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  const oldUrl = process.env.HUB_DATABASE_URL, oldAllow = process.env.HUB_ALLOW_LOCAL_DB;
  const db = createClient({ url });
  try {
    await db.executeMultiple(await readFile('db/hub-migrations/001_initial.sql', 'utf8'));
    await seedGovernmentSources(db);
    const setup = await setupOwner(db, { password: 'temporary-password', token: 'temporary-setup-token-at-least-32-characters' }, 'temporary-setup-token-at-least-32-characters');
    if (!setup.ok) throw new Error('fixture setup failed');
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    const routes = await import('../src/app/api/hub/sources/route');
    const base = 'http://localhost:3100';
    assert.equal((await routes.GET(new Request(base + '/api/hub/sources'))).status, 401);
    const body = JSON.stringify({ name: 'Sumber uji', jurisdiction: 'Wilayah uji', region: 'NTB', url: 'https://example.test/feed', kind: 'rss' });
    const cookie = `hub_session=${setup.session}`;
    const noCsrf = new Request(base + '/api/hub/sources', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body });
    assert.equal((await routes.POST(noCsrf)).status, 403);
    const request = () => new Request(base + '/api/hub/sources', { method: 'POST', headers: { cookie, origin: base, 'X-Hub-Request': '1', 'Content-Type': 'application/json' }, body });
    const created = await routes.POST(request()); assert.equal(created.status, 200); const data = await created.json(); assert.equal(data.active, false); assert.equal(data.verified, false);
    assert.equal((await routes.POST(request())).status, 409);
    const response = await routes.GET(new Request(base + '/api/hub/sources', { headers: { cookie } })); const result = await response.json();
    assert.equal(result.sources.length, 12); const row = result.sources.find((s: { id: string }) => s.id === data.id); assert.equal(row.active, false); assert.equal(row.discoveredType, 'unverified'); assert.equal(row.feedUrl, null);
  } finally {
    db.close();
    if (oldUrl === undefined) delete process.env.HUB_DATABASE_URL; else process.env.HUB_DATABASE_URL = oldUrl;
    if (oldAllow === undefined) delete process.env.HUB_ALLOW_LOCAL_DB; else process.env.HUB_ALLOW_LOCAL_DB = oldAllow;
    await rm(dir, { recursive: true, force: true });
  }
});
