import test from 'node:test';
import assert from 'node:assert/strict';
import AdminPage from '../src/app/admin/page';

test('read-only Hub shell is offered only in Preview with no Hub database URL', () => {
  const env = process.env.VERCEL_ENV, db = process.env.HUB_DATABASE_URL;
  try {
    process.env.VERCEL_ENV = 'preview'; delete process.env.HUB_DATABASE_URL;
    assert.equal(AdminPage().props.staticPreviewEnabled, true);
    process.env.HUB_DATABASE_URL = 'libsql://example.test';
    assert.equal(AdminPage().props.staticPreviewEnabled, false);
    delete process.env.HUB_DATABASE_URL; process.env.VERCEL_ENV = 'production';
    assert.equal(AdminPage().props.staticPreviewEnabled, false);
    delete process.env.VERCEL_ENV;
    assert.equal(AdminPage().props.staticPreviewEnabled, false);
  } finally {
    if (env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env;
    if (db === undefined) delete process.env.HUB_DATABASE_URL; else process.env.HUB_DATABASE_URL = db;
  }
});
