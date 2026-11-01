import test from 'node:test';
import assert from 'node:assert/strict';
import {writesAllowed, writeTarget, writeGateMessage} from '../src/server/hub/security/write-gate';

const prod = {VERCEL_ENV: 'production'} as Record<string, string>;
const prev = {VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'webhub'} as Record<string, string>;
const otherPrev = {VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'lain'} as Record<string, string>;

test('bawaan (tanpa HUB_WRITE_TARGET) tetap hanya Preview branch webhub — perilaku lama tidak berubah', () => {
  assert.equal(writeTarget({}), 'preview');
  assert.equal(writesAllowed(prev), true);
  assert.equal(writesAllowed(prod), false, 'Production TIDAK boleh menulis tanpa saklar');
  assert.equal(writesAllowed(otherPrev), false);
});

test('HUB_WRITE_TARGET=production membuka Production dan menutup Preview', () => {
  const env = {...prod, HUB_WRITE_TARGET: 'production'};
  assert.equal(writesAllowed(env), true);
  assert.equal(writesAllowed({...prev, HUB_WRITE_TARGET: 'production'}), false);
});

test('HUB_WRITE_TARGET=both membuka keduanya', () => {
  assert.equal(writesAllowed({...prod, HUB_WRITE_TARGET: 'both'}), true);
  assert.equal(writesAllowed({...prev, HUB_WRITE_TARGET: 'both'}), true);
});

test('nilai ngawur tidak pernah membuka Production', () => {
  for (const v of ['PRODUKSI', 'true', 'ya', 'production ']) {
    const env = {...prod, HUB_WRITE_TARGET: v};
    if (v === 'production ') continue; // spasi dirapikan → sah
    assert.equal(writesAllowed(env), false, `nilai "${v}" tidak boleh membuka Production`);
  }
  assert.equal(writesAllowed({...prod, HUB_WRITE_TARGET: 'production '}), true, 'spasi dirapikan');
});

test('pesan galat menyebut tempat kejadian dan cara membukanya', () => {
  const msg = writeGateMessage(prod);
  assert.match(msg, /Production/);
  assert.match(msg, /HUB_WRITE_TARGET/);
});
