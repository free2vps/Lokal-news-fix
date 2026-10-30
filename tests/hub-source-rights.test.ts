import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {addManualSource, setSourceRights, listSourceRightsLog} from '../src/server/hub/domain/sources';
import {prepareProfiles, profileBatch} from '../src/server/hub/domain/content-profile';
import {prepareValues, valueBatch} from '../src/server/hub/domain/editorial-value';
import {prepareAutoEditor, saveAutoConfig, setAutoEditor, runAutoEditor} from '../src/server/hub/domain/auto-editor';

const NOW = Date.parse('2026-10-30T10:00:00Z');

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rights-'));
  const db = createClient({url: 'file:' + path.join(dir, 'r.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return db;
}

async function rssSource(db: any, name: string, region: string) {
  const out = await addManualSource(db, {name, jurisdiction: 'Provinsi', region, url: `https://${name}.example.org/rss`, kind: 'rss'});
  await db.execute({sql: "UPDATE hub_sources SET is_active=1,discovered_type='rss',feed_url=? WHERE id=?", args: [`https://${name}.example.org/rss`, out.id]});
  return out.id as string;
}

test('hak sumber: bawaan unverified/unknown dan bisa ditandai, dengan riwayat', async () => {
  const db = await fixture();
  try {
    const id = await rssSource(db, 'media-a', 'NTB');
    const before = (await db.execute({sql: 'SELECT rights_status FROM hub_sources WHERE id=?', args: [id]})).rows[0];
    assert.equal(before.rights_status, 'unknown');
    const out = await setSourceRights(db, id, 'permission_confirmed', 'owner', NOW);
    assert.equal(out.to, 'permission_confirmed');
    assert.equal(out.from, 'unknown');
    const after = (await db.execute({sql: 'SELECT rights_status FROM hub_sources WHERE id=?', args: [id]})).rows[0];
    assert.equal(after.rights_status, 'permission_confirmed');
    const log = await listSourceRightsLog(db);
    assert.equal(log.length, 1);
    assert.equal(log[0].to, 'permission_confirmed');
    assert.equal(log[0].from, 'unknown');
    // Menurunkan kembali juga tercatat.
    await setSourceRights(db, id, 'metadata_only', 'owner', NOW + 1000);
    const log2 = await listSourceRightsLog(db);
    assert.equal(log2.length, 2);
    assert.equal(log2[0].to, 'metadata_only');
  } finally { await db.close(); }
});

test('hak sumber: menolak status ngawur, id salah, dan sumber yang tidak ada', async () => {
  const db = await fixture();
  try {
    const id = await rssSource(db, 'media-b', 'NTB');
    await assert.rejects(() => setSourceRights(db, id, 'bebas', 'owner', NOW), /RIGHTS_INVALID/);
    await assert.rejects(() => setSourceRights(db, 'bukan-uuid', 'permission_confirmed', 'owner', NOW), /SOURCE_INVALID/);
    await assert.rejects(() => setSourceRights(db, '11111111-1111-1111-1111-111111111111', 'permission_confirmed', 'owner', NOW), /SOURCE_NOT_FOUND/);
    const row = (await db.execute({sql: 'SELECT rights_status FROM hub_sources WHERE id=?', args: [id]})).rows[0];
    assert.equal(row.rights_status, 'unknown', 'tidak ada perubahan saat gagal');
    assert.equal((await listSourceRightsLog(db)).length, 0);
  } finally { await db.close(); }
});

test('hak sumber: menandai permission_confirmed membuka jalan redaktur otomatis', async () => {
  const db = await fixture();
  try {
    const id = await rssSource(db, 'media-c', 'NTB');
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_category,version,review_state) VALUES('legacy-news:aaaaaaaa-0000-0000-0000-000000000001',?,'k1','https://media-c.example.org/1','https://media-c.example.org/1','Beasiswa pelajar NTB dibuka','Pemerintah provinsi membuka pendaftaran beasiswa bagi pelajar dan mahasiswa. Pendaftaran ditutup 30 November 2026 melalui portal resmi. Kuota 500 penerima tahap pertama.','2026-10-30T08:00:00Z','2026-10-30','2026-10-30','Pendidikan',1,'pending_review')", args: [id]});
    await prepareProfiles(db); await profileBatch(db, '');
    await prepareValues(db); await valueBatch(db, '');
    await prepareAutoEditor(db);
    await saveAutoConfig(db, {minTier: 'radar', aiPerRun: 0}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);

    // Sebelum ditandai: diblokir oleh hak.
    const before = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: (async (items: any[]) => ({published: items.map(i => i.id), duplicates: [], failed: [], target: 'fake'})) as any});
    assert.equal(before.published, 0);
    assert.equal(before.reasons.rights_unknown, 1);

    await setSourceRights(db, id, 'permission_confirmed', 'owner', NOW);
    const after = await runAutoEditor(db, {now: NOW + 1000, skipPull: true, deliver: (async (items: any[]) => ({published: items.map(i => i.id), duplicates: [], failed: [], target: 'fake'})) as any});
    assert.equal(after.published, 1, 'setelah hak ditandai, berita bisa terbit otomatis');
    assert.equal(after.candidates, 1);
  } finally { await db.close(); }
});

test('hak sumber API: butuh sesi owner + CSRF + konfirmasi teks, dan mencatat perubahan', async () => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const pathMod = (await import('node:path')).default;
  const osMod = (await import('node:os')).default;
  const {setupOwner} = await import('../src/server/hub/security/auth');
  const dir = await mkdtemp(pathMod.join(osMod.tmpdir(), 'rights-api-')); const url = 'file:' + pathMod.join(dir, 'r.db');
  const db = createClient({url});
  const keys = ['HUB_DATABASE_URL', 'HUB_ALLOW_LOCAL_DB', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF'], old = keys.map(k => process.env[k]);
  try {
    await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
    const user = await setupOwner(db, {token: 'test-setup-token-long-enough-not-real', password: 'rights-password-test-123'}, 'test-setup-token-long-enough-not-real');
    if (!user.ok) throw Error('fixture');
    const sid = await rssSource(db, 'media-d', 'NTB');
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'webhub';
    const route = await import('../src/app/api/hub/sources/route');
    const origin = 'http://localhost:3100';
    const headers = {cookie: 'hub_session=' + user.session};
    const post = (body: unknown, csrf = true) => new Request(origin + '/api/hub/sources', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json', ...(csrf ? {origin, 'X-Hub-Request': '1'} : {})}, body: JSON.stringify(body)});

    assert.equal((await route.POST(post({action: 'rights', id: sid, status: 'permission_confirmed', confirm: 'TANDAI HAK SUMBER'}, false))).status, 403, 'tanpa CSRF ditolak');
    assert.equal((await route.POST(new Request(origin + '/api/hub/sources', {method: 'POST', headers: {'Content-Type': 'application/json', origin, 'X-Hub-Request': '1'}, body: JSON.stringify({action: 'rights', id: sid, status: 'permission_confirmed', confirm: 'TANDAI HAK SUMBER'})}))).status, 401, 'tanpa sesi ditolak');
    assert.equal((await route.POST(post({action: 'rights', id: sid, status: 'permission_confirmed', confirm: 'salah'}))).status, 400, 'konfirmasi salah ditolak');
    assert.equal((await route.POST(post({action: 'rights', id: sid, status: 'ngawur', confirm: 'TANDAI HAK SUMBER'}))).status, 400);
    const ok = await route.POST(post({action: 'rights', id: sid, status: 'permission_confirmed', confirm: 'TANDAI HAK SUMBER'}));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.to, 'permission_confirmed');
    assert.equal(body.log.length, 1);
    const row = (await db.execute({sql: 'SELECT rights_status FROM hub_sources WHERE id=?', args: [sid]})).rows[0];
    assert.equal(row.rights_status, 'permission_confirmed');
    const list = await (await route.GET(new Request(origin + '/api/hub/sources', {headers}))).json();
    assert.equal(list.rightsLog.length, 1);
  } finally {
    db.close();
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    await rm(dir, {recursive: true, force: true});
  }
});
