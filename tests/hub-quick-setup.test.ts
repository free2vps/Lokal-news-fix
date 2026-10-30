import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {quickSetup, quickStatus, QUICK_SETUP_CONFIRM} from '../src/server/hub/domain/quick-setup';
import {readAutoConfig} from '../src/server/hub/domain/auto-editor';
import {verifyAutomationToken} from '../src/server/hub/domain/automation';
import {verifySocialToken} from '../src/server/hub/domain/social-pull';

const NOW = Date.parse('2026-10-30T10:00:00Z');

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quick-'));
  const db = createClient({url: 'file:' + path.join(dir, 'q.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  const src = (id: string, name: string, kind: string, type: string, feed: string | null, active: number) => db.execute({
    sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,discovered_type,feed_url,rights_status,is_active,created_at,updated_at) VALUES(?,?,'Provinsi','NTB',?,?,?,?,?,?,'unknown',?,'2026-10-30','2026-10-30')",
    args: [id, name, 'https://' + name + '.example.org', 'https://' + name + '.example.org', name + '.example.org', kind, type, feed, active],
  });
  await src('11111111-1111-1111-1111-111111111111', 'media-siap', 'rss', 'rss', 'https://media-siap.example.org/rss', 0);
  await src('22222222-2222-2222-2222-222222222222', 'media-belum-verif', 'rss', 'unverified', 'https://media-belum-verif.example.org/rss', 0);
  await src('33333333-3333-3333-3333-333333333333', 'pemda-situs', 'government_website', 'unverified', null, 0);
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return db;
}

test('Sekali Atur: satu konfirmasi menyiapkan tabel, mengaktifkan sumber siap, menandai hak, dan menyalakan redaktur', async () => {
  const db = await fixture();
  try {
    const out = await quickSetup(db, {actor: 'owner', confirm: QUICK_SETUP_CONFIRM, issueTokens: false, now: NOW});
    assert.equal(out.sources.included.length, 1, 'hanya feed yang terverifikasi disertakan');
    assert.equal(out.sources.included[0].name, 'media-siap');
    assert.equal(out.sources.included[0].rights, 'permission_confirmed');
    const skipped = Object.fromEntries(out.sources.skipped.map(s => [s.name, s.reason]));
    assert.equal(skipped['media-belum-verif'], 'feed_belum_terverifikasi');
    assert.equal(skipped['pemda-situs'], 'bukan_rss');
    const row = (await db.execute({sql: "SELECT is_active,rights_status FROM hub_sources WHERE name='media-siap'"})).rows[0];
    assert.equal(Number(row.is_active), 1, 'sumber diaktifkan');
    assert.equal(row.rights_status, 'permission_confirmed', 'hak ditandai dalam langkah yang sama');
    assert.equal((await readAutoConfig(db)).enabled, true, 'redaktur dinyalakan');
    // Tabel pendukung ikut siap.
    const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r => String(r.name));
    for (const t of ['hub_editorial_value_v2', 'hub_ai_summaries_v2', 'hub_social_queue_v2', 'hub_auto_editor_runs_v2']) assert.ok(tables.includes(t), t);
    assert.ok(out.tables.every(t => t.ok), 'semua tabel pendukung ok');
    assert.ok(out.next.length >= 1);
  } finally { await db.close(); }
});

test('Sekali Atur: tanpa konfirmasi ditolak, dan tidak ada yang berubah', async () => {
  const db = await fixture();
  try {
    await assert.rejects(() => quickSetup(db, {actor: 'owner', confirm: 'salah', now: NOW}), /CONFIRM_REQUIRED/);
    const row = (await db.execute({sql: "SELECT is_active,rights_status FROM hub_sources WHERE name='media-siap'"})).rows[0];
    assert.equal(Number(row.is_active), 0);
    assert.equal(row.rights_status, 'unknown');
    assert.equal((await readAutoConfig(db)).enabled, false);
  } finally { await db.close(); }
});

test('Sekali Atur: token hanya diterbitkan bila diminta, dan token itu benar-benar berlaku', async () => {
  const db = await fixture();
  try {
    const tanpa = await quickSetup(db, {actor: 'owner', confirm: QUICK_SETUP_CONFIRM, issueTokens: false, now: NOW});
    assert.equal(tanpa.tokens.automation, undefined);
    assert.equal(tanpa.tokens.social, undefined);
    const dengan = await quickSetup(db, {actor: 'owner', confirm: QUICK_SETUP_CONFIRM, issueTokens: true, now: NOW + 1000});
    assert.match(String(dengan.tokens.automation), /^[0-9a-f]{64}$/);
    assert.match(String(dengan.tokens.social), /^[0-9a-f]{64}$/);
    assert.equal(await verifyAutomationToken(db, 'Bearer ' + dengan.tokens.automation, NOW), true);
    assert.equal(await verifySocialToken(db, 'Bearer ' + dengan.tokens.social, NOW), true);
    // Token tersimpan sebagai hash, bukan teks asli.
    const stored = String((await db.execute('SELECT token_hash FROM hub_automation_tokens_v2')).rows[0].token_hash);
    assert.notEqual(stored, dengan.tokens.automation);
  } finally { await db.close(); }
});

test('Sekali Atur: mode metadata_only tidak menandai izin terbit, dan kriteria bisa diubah sekalian', async () => {
  const db = await fixture();
  try {
    const out = await quickSetup(db, {actor: 'owner', confirm: QUICK_SETUP_CONFIRM, rights: 'metadata_only', enable: false, minTier: 'radar', windowHours: 72, issueTokens: false, now: NOW});
    assert.equal(out.sources.included[0].rights, 'metadata_only');
    const cfg = await readAutoConfig(db);
    assert.equal(cfg.enabled, false, 'enable:false tidak menyalakan redaktur');
    assert.equal(cfg.minTier, 'radar');
    assert.equal(cfg.windowHours, 72);
  } finally { await db.close(); }
});

test('status ringkas memberi petunjuk yang jelas pada tiga keadaan', async () => {
  const db = await fixture();
  try {
    const awal = await quickStatus(db);
    assert.equal(awal.configured, false);
    assert.match(awal.hint, /Sekali Atur/);
    await quickSetup(db, {actor: 'owner', confirm: QUICK_SETUP_CONFIRM, issueTokens: false, now: NOW});
    const sesudah = await quickStatus(db);
    assert.equal(sesudah.rightsConfirmed, 1);
    assert.equal(sesudah.editorEnabled, true);
    assert.match(sesudah.hint, /Siap/);
  } finally { await db.close(); }
});
