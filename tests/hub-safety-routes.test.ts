import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GET as cron } from '../src/app/api/cron/route';
import { GET as trendCron } from '../src/app/api/cron/trending/route';
import { POST as oldPush } from '../src/app/api/content-hub/push/route';
import { POST as oldSocialWebhook } from '../src/app/api/webhooks/social-share/route';

test('legacy mutation routes fail closed regardless of old environment flags', async () => {
  const old = process.env.CONTENT_HUB_ENABLED;
  try {
    process.env.CONTENT_HUB_ENABLED = 'true';
    for (const action of [cron, trendCron, oldPush, oldSocialWebhook]) {
      const result = await action();
      assert.equal(result.status, 503); assert.equal((await result.json()).ok, false);
    }
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    assert.deepEqual(vercel.crons, []);
  } finally { if (old === undefined) delete process.env.CONTENT_HUB_ENABLED; else process.env.CONTENT_HUB_ENABLED = old; }
});
