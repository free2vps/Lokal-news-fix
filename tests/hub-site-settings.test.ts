import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { readPublicSocial, readSiteSettings, saveSiteSettings, validSocialUrl } from '../src/server/hub/domain/site-settings';

function db() {
  const dir = mkdtempSync(join(tmpdir(), 'hubsiteset-'));
  return createClient({ url: 'file:' + join(dir, 't.db') });
}

test('tautan medsos hanya menerima alamat http/https yang wajar', () => {
  assert.equal(validSocialUrl('https://instagram.com/kabarlokal'), 'https://instagram.com/kabarlokal');
  assert.equal(validSocialUrl('  https://x.com/kabarlokal  '), 'https://x.com/kabarlokal');
  assert.equal(validSocialUrl(''), '');
  assert.equal(validSocialUrl('instagram.com/kabarlokal'), null, 'tanpa https harus ditolak');
  assert.equal(validSocialUrl('javascript:alert(1)'), null);
  assert.equal(validSocialUrl('https://user:pass@evil.test/x'), null, 'nama pengguna/sandi ditolak');
  assert.equal(validSocialUrl('https://' + 'a'.repeat(400)), null);
  assert.equal(validSocialUrl(123), null);
});

test('simpan lalu baca kembali dari database (bukan env)', async () => {
  const c = db();
  await saveSiteSettings(c, { social_instagram: 'https://instagram.com/kabarlokal', social_x: '' });
  const values = await readSiteSettings(c);
  assert.equal(values.social_instagram, 'https://instagram.com/kabarlokal');
  assert.equal(values.social_x, '', 'kosong berarti tombol disembunyikan');
  assert.equal(values.social_facebook, '');
});

test('tautan kosong tidak pernah tampil sebagai tombol', async () => {
  const c = db();
  await saveSiteSettings(c, { social_instagram: 'https://instagram.com/a', social_facebook: '' });
  const pub = await readPublicSocial(c);
  assert.deepEqual(pub.map(x => x.label), ['Instagram']);
});

test('menyimpan sebagian tidak menghapus kunci lain', async () => {
  const c = db();
  await saveSiteSettings(c, { social_instagram: 'https://instagram.com/a', social_youtube: 'https://youtube.com/@a' });
  await saveSiteSettings(c, { social_instagram: 'https://instagram.com/b' });
  const values = await readSiteSettings(c);
  assert.equal(values.social_instagram, 'https://instagram.com/b');
  assert.equal(values.social_youtube, 'https://youtube.com/@a', 'kunci lain harus utuh');
});

test('tautan tidak sah ditolak dan tidak tersimpan', async () => {
  const c = db();
  await assert.rejects(() => saveSiteSettings(c, { social_x: 'bukan-url' }), /SOCIAL_URL_INVALID/);
  const values = await readSiteSettings(c);
  assert.equal(values.social_x, '');
});
