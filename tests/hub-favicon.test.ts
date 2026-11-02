import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, statSync} from 'node:fs';

test('favicon tersedia dalam bentuk berkas yang dikenali Next.js', () => {
  // Next.js App Router otomatis memasang <link rel="icon"> dari src/app/icon.png
  for (const f of ['src/app/icon.png', 'src/app/apple-icon.png', 'public/favicon.ico']) {
    assert.ok(existsSync(f), `${f} harus ada`);
    assert.ok(statSync(f).size > 300, `${f} tidak boleh kosong`);
  }
  const kepala = readFileSync('src/app/icon.png').subarray(0, 8).toString('hex');
  assert.equal(kepala, '89504e470d0a1a0a', 'icon.png harus PNG sah');
  assert.equal(readFileSync('public/favicon.ico').subarray(0, 4).toString('hex'), '00000100', 'favicon.ico harus ICO sah');
});

test('nama di tab browser "Portal-hub", bukan "portal-hub"', () => {
  const isi = readFileSync('src/config/site.ts', 'utf8');
  assert.ok(/charAt\(0\)\.toUpperCase\(\)/.test(isi), 'huruf pertama nama harus dibesarkan');
  assert.ok(/Portal-hub'/.test(isi), 'nilai cadangan harus Portal-hub');
  const layout = readFileSync('src/app/(public)/layout.tsx', 'utf8');
  assert.match(layout, /title: \{ default: `\$\{SITE\.name\} - Berita Lokal Terkini`/, 'judul tab memakai nama situs');
});
