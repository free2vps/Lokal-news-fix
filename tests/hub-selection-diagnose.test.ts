import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareAutoEditor} from '../src/server/hub/domain/auto-editor';
import {preparePublishSchema} from '../src/server/hub/domain/publish-policy';
import {prepareValues} from '../src/server/hub/domain/editorial-value';
import {prepareProfiles} from '../src/server/hub/domain/content-profile';
import {diagnoseSelection} from '../src/server/hub/domain/selection-diagnose';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const S = {
  ntb: '11111111-1111-1111-1111-111111111111',
  jkt: '22222222-2222-2222-2222-222222222222',
  meta: '33333333-3333-3333-3333-333333333333',
};

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'diagsel-'));
  const db = createClient({url: 'file:' + path.join(dir, 'sel.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  const src = (id: string, name: string, region: string, rights: string) => db.execute({
    sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,is_active,discovered_type,feed_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,'rss',?,?,?)",
    args: [id, name, 'Provinsi', region, 'https://' + name + '.test', 'https://' + name + '.test', name + '.test', 'rss', rights, 'https://' + name + '.test/rss', '2026-10-30', '2026-10-30'],
  });
  await src(S.ntb, 'ntb', 'NTB', 'permission_confirmed');
  await src(S.jkt, 'jkt', 'DKI Jakarta', 'permission_confirmed');
  await src(S.meta, 'meta', 'NTB', 'metadata_only');
  await prepareProfiles(db); await prepareValues(db); await preparePublishSchema(db); await prepareAutoEditor(db);

  const add = async (id: string, sourceId: string, hoursAgo: number, o: {title?: string; snippet?: string; published?: string | null; tier?: string} = {}) => {
    const published = o.published === undefined ? new Date(NOW - hoursAgo * 3600000).toISOString() : o.published;
    await db.execute({
      sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,version,review_state) VALUES(?,?,?,?,?,?,?,?,?,?,1,'pending_review')",
      args: [id, sourceId, 'k-' + id, 'https://x.test/' + id, 'https://x.test/' + id, o.title ?? 'Judul berita ' + id, o.snippet ?? 'Ringkasan berita yang cukup panjang untuk diolah menjadi berita portal.', published, '2026-10-30', '2026-10-30'],
    });
    if (o.tier) {
      await db.execute({sql: 'INSERT INTO hub_editorial_value_v2(item_id,item_version,input_hash,value_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',
        args: [id, 1, 'h' + id, JSON.stringify({tier: o.tier}), '2026-10-30', '2026-10-30']});
    }
  };
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return {db, add};
}

test('funnel menunjukkan gerbang mana yang menghabiskan kandidat', async () => {
  const {db, add} = await fixture();
  await add('A', S.ntb, 1, {tier: 'curated'});                       // lolos
  await add('B', S.jkt, 1, {tier: 'curated'});                       // nasional (tetap lolos)
  await add('C', S.ntb, 80, {tier: 'curated'});                      // terlalu tua
  await add('D', S.ntb, 1, {tier: 'radar'});                         // skor rendah → TETAP lolos (pilihan C)
  await add('E', S.meta, 1, {tier: 'curated'});                      // hak belum terkonfirmasi
  await add('F', S.ntb, 1, {tier: 'curated', title: '', snippet: ''}); // teks kosong
  await add('G', S.ntb, 1, {tier: 'curated', published: null});       // tanggal tak terbaca
  // Outbox punya FK ke hub_item_approvals(item_id,version) — catat persetujuan dulu.
  await db.execute({sql: "INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES('A',1,'{}',?,'test')", args: [new Date(NOW).toISOString()]});
  await db.execute({sql: "INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at) VALUES('o1','k1','A',1,'{}','published',?)", args: [new Date(NOW).toISOString()]});

  const r = await diagnoseSelection(db, {now: NOW});
  assert.equal(r.rowsScanned, 7);
  assert.equal(r.survivors, 2, 'D (skor rendah) dan B (nasional) sama-sama lolos');
  const g = Object.fromEntries(r.gates.map(x => [x.key, x.dropped]));
  assert.equal(g.already_in_outbox, 1);
  assert.equal(g.date_outside_window, 1);
  assert.equal(g.rights_not_permission_confirmed, 1);
  assert.equal(g.value_tier_below_minimum, undefined, 'gerbang skor sudah tidak ada');
  assert.equal(g.text_missing, 1);
  assert.equal(g.date_unreadable, 1);
  assert.match(r.verdict, /2 dari 7/);
  assert.equal(r.allowedRegions.join(','), 'Bali,NTB,NTT');
  await db.close();
});

test('kandidat yang lolos dilaporkan siap terbit + saran yang tepat', async () => {
  const {db, add} = await fixture();
  await add('H', S.ntb, 2, {tier: 'evidence_backed'});
  await add('I', S.ntb, 2, {tier: 'radar'});
  const r = await diagnoseSelection(db, {now: NOW});
  assert.equal(r.survivors, 2, 'skor tinggi maupun rendah sama-sama lolos');
  assert.match(r.verdict, /2 dari 2/);
  assert.match(r.suggestion, /Jalankan sekarang/);
  assert.ok(r.rules.length >= 6 && r.rules.some(x => /Hak sumber/.test(x.label)));
  await db.close();
});

test('berita nasional dipakai untuk mengisi porsi, bukan dibuang', async () => {
  const {db, add} = await fixture();
  await add('J', S.jkt, 3, {tier: 'curated'});
  await add('K', S.jkt, 3, {tier: 'evidence_backed'});
  const r = await diagnoseSelection(db, {now: NOW});
  assert.equal(r.survivors, 2);
  assert.equal(r.regionalSurvivors, 0);
  assert.equal(r.nationalSurvivors, 2);
  assert.equal(r.plan.mixRegionalPct, 60);
  assert.equal(r.plan.regionalWillTake, 0);
  assert.ok(r.plan.nationalWillTake >= 1, 'kapasitas diisi berita nasional');
  await db.close();
});

test('diagnosa seleksi tidak menulis apa pun', async () => {
  const {db, add} = await fixture();
  await add('L', S.ntb, 1, {tier: 'curated'});
  const before = Number((await db.execute('SELECT count(*) n FROM hub_items')).rows[0].n);
  const outBefore = Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n);
  await diagnoseSelection(db, {now: NOW});
  assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_items')).rows[0].n), before);
  assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), outBefore);
  await db.close();
});

test('ringkasan per sumber menandai sumber mana yang terblokir', async () => {
  const {db, add} = await fixture();
  await add('M', S.meta, 1, {tier: 'curated'});
  await add('N', S.meta, 2, {tier: 'curated'});
  const r = await diagnoseSelection(db, {now: NOW});
  const meta = r.sources.find(s => s.id === S.meta)!;
  assert.equal(meta.items, 2);
  assert.equal(meta.passAll, false);
  assert.equal(meta.blockedBy, 'rights_not_permission_confirmed');
  await db.close();
});
