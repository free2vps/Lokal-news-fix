import { createClient } from '@libsql/client';
import { mkdir, readFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { seedGovernmentSources } from '../../src/server/hub/domain/sources';

async function main() {
  if (!process.argv.includes('--local-only') || process.env.VERCEL || process.env.HUB_DATABASE_URL?.startsWith('libsql:') || process.env.HUB_DATABASE_URL?.startsWith('https:')) {
    throw new Error('Hanya diizinkan pada database lokal yang terisolasi.');
  }
  process.umask(0o077);
  const root = process.cwd();
  const dir = path.join(root, 'data');
  const filename = path.join(dir, 'hub-local.db');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const db = createClient({ url: `file:${filename}` });
  try {
    const sql = await readFile(path.join(root, 'db/hub-migrations/001_initial.sql'), 'utf8');
    await db.executeMultiple(sql);
    const results = await seedGovernmentSources(db);
    await chmod(filename, 0o600);
    console.log('Database Hub lokal terisolasi:', filename);
    console.log('Sumber resmi dimasukkan:', results.filter(r => r.status === 'inserted').length,
      '| sudah ada:', results.filter(r => r.status === 'existing').length,
      '| perlu ditinjau karena kemungkinan duplikat:', results.filter(r => r.status === 'possible_duplicate').length);
    console.log('Semua sumber baru nonaktif; tidak ada scheduler, pengumpulan, impor, atau publikasi.');
  } finally { db.close(); }
}
main().catch(error => { console.error('Inisialisasi lokal gagal:', error instanceof Error ? error.message : 'error'); process.exitCode = 1; });
