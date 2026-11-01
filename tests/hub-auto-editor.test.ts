import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareProfiles, profileBatch} from '../src/server/hub/domain/content-profile';
import {prepareValues, valueBatch} from '../src/server/hub/domain/editorial-value';
import {prepareSummarySchema} from '../src/server/hub/domain/ai-summary';
import {preparePublishSchema} from '../src/server/hub/domain/publish-policy';
import {prepareSocialSchema} from '../src/server/hub/domain/social-pull';
import {
  prepareAutoEditor, runAutoEditor, readAutoConfig, saveAutoConfig, setAutoEditor, setRightsMode,
  autoEditorStatus, keyPoints, AUTO_EDITOR_POLICY,
} from '../src/server/hub/domain/auto-editor';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const SRC_NTB = '33333333-3333-3333-3333-333333333333';
const SRC_JKT = '44444444-4444-4444-4444-444444444444';
const SRC_META = '55555555-5555-5555-5555-555555555555';
const id = (n: number) => `legacy-news:00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

const SNIPPET = 'Pemerintah Provinsi Nusa Tenggara Barat membuka pendaftaran beasiswa bagi pelajar dan mahasiswa berprestasi. Pendaftaran ditutup pada 30 November 2026 melalui portal resmi. Kuota tahap pertama sebanyak 500 penerima.';

async function fixture(opts: {rights?: string} = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'autoed-'));
  const db = createClient({url: 'file:' + path.join(dir, 'autoed.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  const src = (sid: string, name: string, region: string, rights: string) => db.execute({
    sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,is_active,discovered_type,feed_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,'rss',?,?,?)",
    args: [sid, name, 'Provinsi', region, 'https://' + name + '.example.org', 'https://' + name + '.example.org', name + '.example.org', 'rss', rights, 'https://' + name + '.example.org/rss', '2026-10-30', '2026-10-30'],
  });
  await src(SRC_NTB, 'media-ntb', 'NTB', opts.rights ?? 'permission_confirmed');
  await src(SRC_JKT, 'media-jkt', 'DKI Jakarta', 'permission_confirmed');
  await src(SRC_META, 'media-meta', 'NTB', 'metadata_only');

  let n = 0;
  const add = async (sourceId: string, hoursAgo: number, over: {title?: string; summary?: string; snippet?: string} = {}) => {
    n += 1;
    const published = new Date(NOW - hoursAgo * 3600000).toISOString();
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category,version,review_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,'pending_review')",
      args: [id(n), sourceId, 'k' + n, 'https://contoh.example.org/' + n, 'https://contoh.example.org/' + n,
        over.title ?? 'Beasiswa pelajar NTB tahap ' + n, over.snippet ?? SNIPPET, published, '2026-10-30', '2026-10-30',
        over.title ?? null, over.summary ?? null, 'Pendidikan']});
    return id(n);
  };
  await prepareProfiles(db); await profileBatch(db, '');
  await prepareValues(db); await valueBatch(db, '');
  await prepareSummarySchema(db); await preparePublishSchema(db); await prepareSocialSchema(db);
  await prepareAutoEditor(db);
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return {db, add};
}

const okDeliver = (counter = {calls: 0, items: [] as string[]}) => (async (items: any[]) => {
  counter.calls += 1; counter.items.push(...items.map(i => i.id));
  return {published: items.map(i => i.id), duplicates: [], failed: [], target: 'fake'};
}) as any;

test('redaktur otomatis: bawaan MATI dan tidak menyentuh apa pun', async () => {
  const {db, add} = await fixture();
  try {
    await add(SRC_NTB, 1);
    const cfg = await readAutoConfig(db);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.minTier, 'curated');
    assert.equal(cfg.windowHours, 48);
    assert.deepEqual(cfg.regions, ['Bali', 'NTB', 'NTT']);
    assert.equal(cfg.rightsMode, 'permission_confirmed');
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    assert.equal(out.status, 'disabled');
    assert.equal(out.published, 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_auto_editor_runs_v2')).rows[0].n), 0);
  } finally { await db.close(); }
});

test('redaktur otomatis: skor mutu rendah TIDAK menghalangi terbit (pilihan C)', async () => {
  const {db, add} = await fixture();
  try {
    await add(SRC_NTB, 2);
    // Skor editorial berita ini hanya "radar" (33 poin), jauh di bawah "kurasi" (45).
    // Sejak pilihan C, angka itu informasi saja: syarat terbit hanya daftar lulus/gagal.
    await saveAutoConfig(db, {maxPerRun: 3, maxPerDay: 10}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    assert.equal(out.candidates, 1);
    assert.equal(out.published, 1);
    assert.equal(out.reasons.value_tier_below_minimum, undefined, 'skor tidak lagi menjadi alasan gugur');
    assert.ok(Array.isArray(out.selectionRules) && out.selectionRules.length >= 6, 'syarat terbit dilaporkan ke UI');
  } finally { await db.close(); }
});

test('redaktur otomatis: syarat hak tetap berlaku walau skor tinggi', async () => {
  const {db, add} = await fixture();
  try {
    await add(SRC_META, 2); // sumber metadata_only
    await saveAutoConfig(db, {maxPerRun: 3, maxPerDay: 10}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    assert.equal(out.published, 0);
    assert.equal(out.reasons.rights_not_permission_confirmed, 1);
  } finally { await db.close(); }
});

test('redaktur otomatis: menerbitkan otomatis saat kelas diturunkan, dengan batas per putaran', async () => {
  const {db, add} = await fixture();
  try {
    for (let i = 0; i < 5; i++) await add(SRC_NTB, 1 + i);
    await saveAutoConfig(db, {minTier: 'radar', maxPerRun: 3, maxPerDay: 10}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const counter = {calls: 0, items: [] as string[]};
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver(counter)});
    assert.equal(out.published, 3, 'maksimum 3 per putaran');
    assert.equal(counter.items.length, 3);
    const queued = (await db.execute("SELECT item_id,status FROM hub_publish_outbox ORDER BY created_at")).rows;
    assert.equal(queued.length, 3);
    assert.ok(queued.every(r => r.status === 'published'));
    // Putaran kedua mengambil sisa, tidak mengulang yang sudah terbit.
    const second = await runAutoEditor(db, {now: NOW + 1000, skipPull: true, deliver: okDeliver(counter)});
    assert.equal(second.published, 2);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 5);
    const third = await runAutoEditor(db, {now: NOW + 2000, skipPull: true, deliver: okDeliver(counter)});
    assert.equal(third.published, 0);
    assert.equal(third.reasons.already_in_outbox, 5);
    // Satu pemicu juga mengisi antrean media sosial untuk Make.
    const queue = await db.execute("SELECT count(*) n FROM hub_social_queue_v2 WHERE status='pending'");
    assert.equal(Number(queue.rows[0].n), 5);
    assert.equal(third.steps.find(s => s.step === 'social_queue')?.ok, true);
  } finally { await db.close(); }
});

test('redaktur otomatis: umur ≤ 48 jam dan hak sumber tetap menjadi syarat; wilayah hanya porsi', async () => {
  const {db, add} = await fixture();
  try {
    const ntb = await add(SRC_NTB, 2);
    const jkt = await add(SRC_JKT, 2, {title: 'Harga cabai di pasar induk naik', snippet: 'Harga cabai merah di pasar induk naik menjelang akhir bulan. Pedagang menyebut pasokan berkurang dalam sepekan terakhir. Pemerintah kota menyiapkan operasi pasar.'});
    const old = await add(SRC_NTB, 72);
    const meta = await add(SRC_META, 2, {title: 'Beasiswa pemuda NTB dibuka', snippet: SNIPPET});
    await saveAutoConfig(db, {mixRegionalPct: 60, maxPerRun: 10, maxPerDay: 10}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const counter = {calls: 0, items: [] as string[]};
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver(counter)});
    // Berita nasional (Jakarta, tanpa kata wilayah prioritas) kini ikut terbit — sesuai keputusan pemilik.
    assert.equal(out.published, 2);
    assert.ok(counter.items.includes(ntb), 'berita daerah terbit');
    assert.ok(counter.items.includes(jkt), 'berita nasional terbit mengisi porsi');
    assert.ok(!counter.items.includes(old), 'lebih tua dari 48 jam tidak terbit');
    assert.ok(!counter.items.includes(meta), 'sumber metadata_only tidak terbit pada mode bawaan');
    assert.equal(out.composition!.regional, 1);
    assert.equal(out.composition!.national, 1);
    assert.equal(out.reasons.region_not_allowlisted, undefined, 'wilayah tidak lagi menjadi gerbang');
    assert.equal(out.reasons.date_outside_window, 1);
    assert.equal(out.reasons.rights_not_permission_confirmed, 1);
  } finally { await db.close(); }
});

test('redaktur otomatis: batas harian dihormati lintas putaran', async () => {
  const {db, add} = await fixture();
  try {
    for (let i = 0; i < 5; i++) await add(SRC_NTB, 1 + i);
    await saveAutoConfig(db, {minTier: 'radar', maxPerRun: 5, maxPerDay: 2}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const first = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    assert.equal(first.published, 2, 'dibatasi maxPerDay=2');
    const second = await runAutoEditor(db, {now: NOW + 1000, skipPull: true, deliver: okDeliver()});
    assert.equal(second.published, 0);
    assert.equal(second.reasons.daily_limit_reached, 3);
  } finally { await db.close(); }
});

test('redaktur otomatis: ringkasan ekstraktif + poin penting tanpa mengarang, edit manual tidak ditimpa', async () => {
  const {db, add} = await fixture();
  try {
    const manualId = await add(SRC_NTB, 1, {title: 'Judul suntingan manusia', summary: 'Ringkasan buatan editor manusia yang harus dipertahankan.'});
    const autoId = await add(SRC_NTB, 2);
    await saveAutoConfig(db, {minTier: 'radar', aiPerRun: 0}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    const rows = (await db.execute('SELECT item_id,title,summary,bullets_json,method FROM hub_auto_editorial_v2')).rows;
    const manual = rows.find(r => r.item_id === manualId)!;
    const auto = rows.find(r => r.item_id === autoId)!;
    assert.equal(manual.method, 'manual');
    assert.equal(manual.title, 'Judul suntingan manusia');
    assert.match(String(manual.summary), /editor manusia/);
    assert.equal(auto.method, 'extractive');
    assert.ok(String(auto.summary).length > 80);
    const numbers = String(auto.summary).match(/\d[\d.,]*/g) || [];
    for (const num of numbers) assert.ok(SNIPPET.includes(num), `angka ${num} harus berasal dari sumber`);
    const bullets: string[] = JSON.parse(String(auto.bullets_json));
    assert.ok(bullets.length <= AUTO_EDITOR_POLICY.bulletsMax);
    for (const b of bullets) assert.ok(SNIPPET.includes(b.replace(/\s+/g, ' ').trim().slice(0, 40)));
    // Teks editorial asli di hub_items tidak diubah oleh redaktur otomatis.
    const item = (await db.execute({sql: 'SELECT editorial_summary,review_state FROM hub_items WHERE id=?', args: [autoId]})).rows[0];
    assert.equal(item.editorial_summary, null);
    assert.equal(item.review_state, 'pending_review');
  } finally { await db.close(); }
});

test('redaktur otomatis: saklar mati menghentikan penerbitan seketika', async () => {
  const {db, add} = await fixture();
  try {
    for (let i = 0; i < 3; i++) await add(SRC_NTB, 1 + i);
    await saveAutoConfig(db, {minTier: 'radar'}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    await setAutoEditor(db, false, undefined, 'owner', NOW);
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    assert.equal(out.status, 'disabled');
    assert.equal(out.published, 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
  } finally { await db.close(); }
});

test('redaktur otomatis: mode headline butuh konfirmasi dan mematikan saklar', async () => {
  const {db, add} = await fixture();
  try {
    await add(SRC_META, 1);
    await saveAutoConfig(db, {minTier: 'radar'}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    await assert.rejects(() => setRightsMode(db, 'metadata_only', 'salah', 'owner', NOW), /CONFIRM_REQUIRED/);
    const cfg = await setRightsMode(db, 'metadata_only', 'AKTIFKAN MODE HEADLINE', 'owner', NOW);
    assert.equal(cfg.rightsMode, 'metadata_only');
    assert.equal(cfg.enabled, false, 'mengubah dasar hak mematikan redaktur; harus dinyalakan ulang sadar');
    await assert.rejects(() => setAutoEditor(db, true, 'aktifkan', 'owner', NOW), /CONFIRM_REQUIRED/);
  } finally { await db.close(); }
});

test('redaktur otomatis: kegagalan pengiriman dicatat, tidak mengklaim terbit', async () => {
  const {db, add} = await fixture();
  try {
    await add(SRC_NTB, 1);
    await saveAutoConfig(db, {minTier: 'radar'}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const boom = (async () => { throw Error('PUBLISH_TARGET_NOT_CONFIGURED'); }) as any;
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: boom});
    assert.equal(out.published, 0);
    const step = out.steps.find(s => s.step === 'publish');
    assert.equal(step?.ok, false);
    assert.match(String(step?.detail), /PUBLISH_TARGET_NOT_CONFIGURED/);
    assert.equal(Number((await db.execute("SELECT count(*) n FROM hub_publish_outbox WHERE status='failed'")).rows[0].n), 1, 'kegagalan dicatat sebagai failed, bukan published');
    assert.equal(Number((await db.execute("SELECT count(*) n FROM hub_publish_outbox WHERE status='published'")).rows[0].n), 0);
  } finally { await db.close(); }
});

test('redaktur otomatis: menyiapkan tabel pendukung agar nilai/ringkasan tidak lagi "belum disiapkan"', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'autoed-dep-'));
  const db = createClient({url: 'file:' + path.join(dir, 'd.db')});
  try {
    await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
    const out = await prepareAutoEditor(db);
    assert.ok(Array.isArray(out.dependencies));
    for (const name of ['profiles', 'values', 'summaries', 'autopublish', 'social']) {
      const row = out.dependencies.find(d => d.name === name);
      assert.ok(row, `dependensi ${name} dilaporkan`);
      assert.equal(row!.ok, true, `dependensi ${name} siap`);
    }
    const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r => String(r.name));
    for (const t of ['hub_editorial_value_v2', 'hub_ai_summaries_v2', 'hub_content_profiles_v2', 'hub_autopublish_v2', 'hub_social_queue_v2']) {
      assert.ok(tables.includes(t), `tabel ${t} dibuat`);
    }
  } finally { await db.close(); try { rmSync(dir, {recursive: true, force: true}); } catch {} }
});

test('redaktur otomatis: langkah tarik melaporkan alasan per sumber (bukan sekadar "0 berita")', async () => {
  const {db} = await fixture();
  try {
    // Sumber kedua dengan feed yang tidak bisa diakses: harus muncul sebagai gagal + kode alasan.
    await db.execute({sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,is_active,discovered_type,feed_url,created_at,updated_at) VALUES('66666666-6666-6666-6666-666666666666','media-mati','Provinsi','NTB','https://127.0.0.1.example.org','https://127.0.0.1.example.org','127.0.0.1.example.org','rss','permission_confirmed',1,'rss','https://localhost/feed','2026-10-30','2026-10-30')", args: []});
    await saveAutoConfig(db, {minTier: 'radar', aiPerRun: 0}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const out = await runAutoEditor(db, {now: NOW, deliver: okDeliver()});
    const pull = out.steps.find(s => s.step === 'pull')!;
    assert.ok(Array.isArray(pull.sources) && pull.sources.length >= 1, 'ada rincian per sumber');
    const bad = pull.sources!.find(x => x.id === '66666666-6666-6666-6666-666666666666');
    assert.ok(bad && bad.ok === false, 'sumber bermasalah dilaporkan gagal');
    assert.ok(String(bad!.error).length > 0, 'kode alasan diisi, bukan kosong');
    assert.match(String(pull.detail), /gagal/);
  } finally { await db.close(); }
});

test('redaktur otomatis: status menampilkan kesiapan hak sumber (blokir nyata saat ini)', async () => {
  const {db, add} = await fixture();
  try {
    await add(SRC_NTB, 1);
    const st = await autoEditorStatus(db);
    assert.equal(st.ready, true);
    assert.equal(st.sources.total, 3);
    assert.equal(st.sources.permissionConfirmed, 2);
    assert.equal(st.sources.metadataOnly, 1);
    assert.equal(st.config.enabled, false);
    assert.equal(st.policy.bulletsMax, 3);
    assert.equal(st.policy.fulltextRehosted, false);
    assert.equal(st.policy.publicationAuto, true);
  } finally { await db.close(); }
});

test('redaktur otomatis: keyPoints hanya memakai kalimat sumber', () => {
  const points = keyPoints(SNIPPET);
  assert.ok(points.length >= 1 && points.length <= 3);
  for (const p of points) assert.ok(SNIPPET.includes(p));
  assert.deepEqual(keyPoints(''), []);
});

test('redaktur otomatis API: owner+CSRF, bearer untuk pemicu, Preview saja', async () => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const pathMod = (await import('node:path')).default;
  const osMod = (await import('node:os')).default;
  const {setupOwner} = await import('../src/server/hub/security/auth');
  const dir = await mkdtemp(pathMod.join(osMod.tmpdir(), 'autoed-api-')); const url = 'file:' + pathMod.join(dir, 'autoed.db');
  const db = createClient({url});
  const keys = ['HUB_DATABASE_URL', 'HUB_ALLOW_LOCAL_DB', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF'], old = keys.map(k => process.env[k]);
  try {
    await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
    const user = await setupOwner(db, {token: 'test-setup-token-long-enough-not-real', password: 'auto-editor-password-test'}, 'test-setup-token-long-enough-not-real');
    if (!user.ok) throw Error('fixture');
    process.env.HUB_DATABASE_URL = url; process.env.HUB_ALLOW_LOCAL_DB = 'true';
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'webhub';
    const route = await import('../src/app/api/hub/auto-editor/route');
    const origin = 'http://localhost:3100';
    const headers = {cookie: 'hub_session=' + user.session};
    const post = (body: unknown, csrf = true) => new Request(origin + '/api/hub/auto-editor', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json', ...(csrf ? {origin, 'X-Hub-Request': '1'} : {})}, body: JSON.stringify(body)});

    assert.equal((await route.GET(new Request(origin + '/api/hub/auto-editor'))).status, 401);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'PREPARE AUTO EDITOR'}, false))).status, 403);
    assert.equal((await route.POST(post({action: 'prepare', confirm: 'salah'}))).status, 400);
    const prep = await route.POST(post({action: 'prepare', confirm: 'PREPARE AUTO EDITOR'}));
    assert.equal(prep.status, 200);
    assert.equal((await prep.json()).ready, true);
    assert.equal((await route.POST(post({action: 'enable', confirm: 'aktifkan'}))).status, 409);
    const on = await (await route.POST(post({action: 'enable', confirm: 'AKTIFKAN REDAKTUR OTOMATIS'}))).json();
    assert.equal(on.config.enabled, true);
    const run = await route.POST(post({action: 'run', confirm: 'RUN AUTO EDITOR'}));
    assert.equal(run.status, 200);
    assert.ok(!(await run.json()).approvalRemainsHuman, 'redaktur otomatis tidak menunggu persetujuan manusia');
    const deny = await route.POST(new Request(origin + '/api/hub/auto-editor?action=run', {method: 'POST', headers: {authorization: 'Bearer ' + 'e'.repeat(64)}}));
    assert.equal(deny.status, 401);
    process.env.VERCEL_ENV = 'production';
    assert.equal((await route.POST(new Request(origin + '/api/hub/auto-editor?action=run', {method: 'POST', headers: {authorization: 'Bearer ' + 'e'.repeat(64)}}))).status, 403);
    assert.equal((await route.POST(post({action: 'run', confirm: 'RUN AUTO EDITOR'}))).status, 403);
  } finally {
    db.close();
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    await rm(dir, {recursive: true, force: true});
  }
});

test('komposisi 60:40 — berita daerah diutamakan, sisanya nasional', async () => {
  const {db, add} = await fixture();
  try {
    for (let i = 0; i < 6; i++) await add(SRC_NTB, 1 + i); // daerah (judul memuat NTB)
    for (let i = 0; i < 6; i++) await add(SRC_JKT, 1 + i, {title: 'Berita ibu kota edisi ' + i, snippet: 'Pemerintah pusat mengumumkan kebijakan baru untuk seluruh wilayah Indonesia pekan ini. Rincian kebijakan disampaikan melalui konferensi pers di Jakarta.'});
    await saveAutoConfig(db, {mixRegionalPct: 60, maxPerRun: 10, maxPerDay: 20}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    assert.equal(out.published, 10);
    assert.equal(out.composition!.regional, 6, 'target 60% dari 10 = 6 daerah');
    assert.equal(out.composition!.national, 4);
    assert.equal(out.available!.regional, 6);
    assert.equal(out.available!.national, 6);
  } finally { await db.close(); }
});

test('komposisi: bila berita daerah kurang, sisa kapasitas diisi nasional', async () => {
  const {db, add} = await fixture();
  try {
    for (let i = 0; i < 2; i++) await add(SRC_NTB, 1 + i);
    for (let i = 0; i < 6; i++) await add(SRC_JKT, 1 + i, {title: 'Berita ibu kota edisi ' + i, snippet: 'Pemerintah pusat mengumumkan kebijakan baru untuk seluruh wilayah Indonesia pekan ini. Rincian kebijakan disampaikan melalui konferensi pers di Jakarta.'});
    await saveAutoConfig(db, {mixRegionalPct: 60, maxPerRun: 6, maxPerDay: 20}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    assert.equal(out.published, 6);
    assert.equal(out.composition!.regional, 2, 'semua daerah terpakai');
    assert.equal(out.composition!.national, 4, 'kapasitas tidak terbuang');
  } finally { await db.close(); }
});

test('komposisi 100% daerah — berita nasional tidak diterbitkan', async () => {
  const {db, add} = await fixture();
  try {
    await add(SRC_NTB, 1);
    for (let i = 0; i < 3; i++) await add(SRC_JKT, 1 + i, {title: 'Berita ibu kota edisi ' + i, snippet: 'Pemerintah pusat mengumumkan kebijakan baru untuk seluruh wilayah Indonesia pekan ini. Rincian kebijakan disampaikan melalui konferensi pers di Jakarta.'});
    await saveAutoConfig(db, {mixRegionalPct: 100, maxPerRun: 5, maxPerDay: 20}, 'owner', NOW);
    await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', 'owner', NOW);
    const out = await runAutoEditor(db, {now: NOW, skipPull: true, deliver: okDeliver()});
    assert.equal(out.published, 1);
    assert.equal(out.composition!.regional, 1);
    assert.equal(out.composition!.national, 0);
  } finally { await db.close(); }
});
