import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/content-hub/route';
// The old capability endpoint also exposed a legacy integration that bypassed
// the new review boundary. It must not advertise working AI until integrated.
test('legacy public AI capability probe fails closed even when the old flag is enabled', async () => {
  const old = process.env.CONTENT_HUB_ENABLED;
  try {
    for (const value of ['true', 'false']) {
      process.env.CONTENT_HUB_ENABLED = value;
      const response = await GET(new NextRequest('https://example.vercel.app/api/content-hub?capabilities=ai-seo-v1'));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.ok, false);
      assert.equal(result.capabilities, undefined);
    }
  } finally { if (old === undefined) delete process.env.CONTENT_HUB_ENABLED; else process.env.CONTENT_HUB_ENABLED = old; }
});
