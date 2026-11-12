import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {readFileSync} from 'node:fs';
import {SECTIGO_DV_R36, trustedCa} from '../src/server/hub/security/extra-ca';

test('sertifikat antara yang ditambahkan adalah sertifikat Sectigo DV R36 yang sah', () => {
  assert.match(SECTIGO_DV_R36, /^-----BEGIN CERTIFICATE-----/);
  assert.match(SECTIGO_DV_R36, /-----END CERTIFICATE-----$/);
  // Isi PEM harus bisa dibaca Node sebagai sertifikat X.509.
  const x = new (require('node:crypto').X509Certificate)(SECTIGO_DV_R36);
  assert.equal(x.subject.includes('CN=Sectigo Public Server Authentication CA DV R36'), true);
  assert.equal(x.ca, true, 'harus sertifikat CA');
  assert.ok(new Date(x.validTo) > new Date('2030-01-01'), 'masih berlaku lama');
});

test('daftar CA = akar bawaan Node + tambahan (bukan menggantikan)', () => {
  const daftar = trustedCa();
  assert.ok(daftar.length >= tls.rootCertificates.length + 1, 'akar bawaan tidak boleh hilang');
  assert.ok(daftar.includes(SECTIGO_DV_R36));
  // Tanpa ini, SEMUA situs lain akan gagal karena opsi `ca` menggantikan daftar bawaan.
  for (const akar of tls.rootCertificates.slice(0, 5)) assert.ok(daftar.includes(akar));
  assert.equal(trustedCa([]).length, tls.rootCertificates.length, 'bisa dipakai tanpa tambahan');
});

test('publicFetch memakai daftar CA itu, bukan mematikan verifikasi', () => {
  const isi = readFileSync('src/server/hub/security/public-fetch.ts', 'utf8');
  assert.ok(/ca:trustedCa\(\)/.test(isi), 'opsi ca harus diisi trustedCa()');
  assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized:\s*false/.test(isi), 'verifikasi TIDAK boleh dimatikan');
});
