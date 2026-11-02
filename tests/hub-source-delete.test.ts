import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { deleteSource } from '../src/server/hub/domain/sources';

async function db() {
  const dir = mkdtempSync(join(tmpdir(), 'hubdel-'));
  const c = createClient({ url: 'file:' + join(dir, 't.db') });
  await c.execute(`CREATE TABLE hub_sources (id TEXT PRIMARY KEY, name TEXT, is_active INTEGER, updated_at TEXT)`);
  await c.execute(`CREATE TABLE hub_items (id TEXT PRIMARY KEY, source_id TEXT)`);
  await c.execute(`CREATE TABLE hub_item_approvals (item_id TEXT, version INTEGER)`);
  await c.execute(`CREATE TABLE hub_publish_outbox (id TEXT PRIMARY KEY, item_id TEXT)`);
  return c;
}
async function isi(c: Awaited<ReturnType<typeof db>>, aktif: number, denganBerita: boolean) {
  await c.execute({ sql: 'INSERT INTO hub_sources VALUES(?,?,?,?)', args: ['s1', 'Sumber uji', aktif, new Date().toISOString()] });
  if (denganBerita) {
    await c.execute({ sql: 'INSERT INTO hub_items VALUES(?,?)', args: ['i1', 's1'] });
    await c.execute({ sql: 'INSERT INTO hub_item_approvals VALUES(?,?)', args: ['i1', 1] });
    await c.execute({ sql: 'INSERT INTO hub_publish_outbox VALUES(?,?)', args: ['o1', 'i1'] });
  }
}

test('sumber yang masih AKTIF tidak boleh dihapus', async () => {
  const c = await db(); await isi(c, 1, false);
  await assert.rejects(() => deleteSource(c, 's1'), /SOURCE_STILL_ACTIVE/);
  assert.equal((await c.execute('SELECT count(*) n FROM hub_sources')).rows[0].n, 1, 'sumber harus utuh');
});

test('sumber mati dihapus bersama data staging-nya, tanpa sisa', async () => {
  const c = await db(); await isi(c, 0, true);
  const out = await deleteSource(c, 's1');
  assert.equal(out.deleted, true);
  assert.equal(out.itemsRemoved, 1);
  for (const t of ['hub_sources', 'hub_items', 'hub_item_approvals', 'hub_publish_outbox'])
    assert.equal((await c.execute(`SELECT count(*) n FROM ${t}`)).rows[0].n, 0, `${t} harus kosong`);
});

test('sumber yang tidak ada dilaporkan jelas', async () => {
  const c = await db();
  await assert.rejects(() => deleteSource(c, 'tidak-ada'), /SOURCE_NOT_FOUND/);
});
