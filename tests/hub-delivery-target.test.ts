import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDeliveryTarget, deliveryReady} from '../src/server/hub/domain/delivery-target';
import {targetConfigured} from '../src/server/hub/domain/publish-policy';
import {supabaseDeliver} from '../src/server/hub/domain/publish-delivery';

test('variabel khusus Hub dipakai lebih dulu', () => {
  const t = resolveDeliveryTarget({HUB_WEBSITE_SUPABASE_URL: 'https://a.supabase.co', HUB_WEBSITE_SERVICE_ROLE_KEY: 'k1', NEXT_PUBLIC_SUPABASE_URL: 'https://b.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k2'} as unknown as NodeJS.ProcessEnv);
  assert.equal(t.source, 'dedicated');
  assert.equal(t.url, 'https://a.supabase.co');
  assert.equal(t.key, 'k1');
});

test('tanpa variabel khusus Hub, kredensial situs dipakai sebagai cadangan', () => {
  const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://site.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'site-key'} as unknown as NodeJS.ProcessEnv;
  const t = resolveDeliveryTarget(env);
  assert.equal(t.source, 'fallback');
  assert.equal(deliveryReady(env), true);
  assert.equal(targetConfigured(env), true);
});

test('tanpa kredensial sama sekali → tidak siap dan tidak ada jaringan', async () => {
  const env = {} as unknown as NodeJS.ProcessEnv;
  assert.equal(resolveDeliveryTarget(env).source, 'none');
  assert.equal(deliveryReady(env), false);
  assert.equal(targetConfigured(env), false);
  let called = 0;
  const fetcher = (async () => { called++; throw Error('tidak boleh dipanggil'); }) as unknown as typeof fetch;
  const deliver = supabaseDeliver(fetcher, env);
  await assert.rejects(() => deliver([{id: 'x', version: 1, snapshot: {editorialTitle: 'A', originalUrl: 'https://x.test/a'}}]), /PUBLISH_TARGET_NOT_CONFIGURED/);
  assert.equal(called, 0);
});

test('cadangan mengirim ke project situs dengan kunci situs', async () => {
  const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://site.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'site-key'} as unknown as NodeJS.ProcessEnv;
  let seen: {url: string; key: string | null} | null = null;
  const fetcher = (async (input: URL | string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    seen = {url: String(input), key: h.get('apikey')};
    return new Response(JSON.stringify([{id: 'id1', source_url: 'https://x.test/a'}]), {status: 201});
  }) as unknown as typeof fetch;
  const res = await supabaseDeliver(fetcher, env)([{id: 'x', version: 1, snapshot: {editorialTitle: 'Judul', originalUrl: 'https://x.test/a', editorialSummary: 'Ringkas', sourcePublishedAt: new Date(Date.now() - 3600000).toISOString()}}]);
  assert.equal(res.published.length, 1);
  assert.ok(seen && (seen as {url: string; key: string | null}).url.startsWith('https://site.supabase.co/rest/v1/articles'));
  assert.equal((seen as {url: string; key: string | null}).key, 'site-key');
});
