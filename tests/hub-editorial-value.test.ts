import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {evaluateValue,prepareValues,valueBatch,valueStatus,getValue,listValues,titleTokens,VALUE_POLICY} from '../src/server/hub/domain/editorial-value';
import {ValueManager,ValueDetails} from '../src/components/hub/EditorialValue';

const id = (n: number) => `legacy-news:00000000-0000-0000-0000-00000000000${n}`;
const base = {
  id: id(1), version: 1, title: 'Beasiswa pelajar Lombok dibuka', sourceId: 's1', sourceName: 'Sumber NTB',
  reviewState: 'pending_review', rightsStatus: 'metadata_only', publishedAt: '2026-10-30T02:00:00Z',
  editorialTitle: false, editorialSummaryChars: 0, editorialCategory: false, observations: 1,
  profile: {regions: ['NTB'], usefulness: ['peluang'], risk: {status: 'not_assessed'}},
  hasAiSummary: false, aiSummaryKind: null, corroboratingSources: 0, corroboratingNames: [],
} as any;

async function fixture(rows: {id: string; title: string; sourceId: string; sourceName: string; editorial?: boolean; profile?: boolean; observation?: boolean}[]) {
  const db = createClient({url: 'file::memory:'});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  for (const s of [...new Set(rows.map(r => r.sourceId))]) {
    await db.execute({sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,rights_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'rss','metadata_only','2026-10-30','2026-10-30')",
      args: [s, rows.find(r => r.sourceId === s)!.sourceName, 'Provinsi', 'NTB', 'https://' + s + '.example.org', 'https://' + s + '.example.org', s + '.example.org']});
  }
  for (const r of rows) {
    await db.execute({sql: "INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,first_seen_at,last_seen_at,editorial_title,editorial_summary,editorial_category) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [r.id, r.sourceId, 'k-' + r.id, 'https://x.example.org/' + r.id, 'https://x.example.org/' + r.id, r.title, 'Cuplikan pendek berita daerah.', '2026-10-30T02:00:00Z', '2026-10-30', '2026-10-30',
        r.editorial ? 'Judul hasil suntingan' : null, r.editorial ? 'Ringkasan hasil suntingan manusia yang menjelaskan isi berita secara lengkap dan rinci untuk pembaca daerah setempat agar mudah dipahami tanpa membuka sumber aslinya sama sekali.' : null, r.editorial ? 'Pendidikan' : null]});
    if (r.observation) await db.execute({sql: 'INSERT INTO hub_item_observations(id,item_id,fingerprint,observed_at,source_title,original_url) VALUES(?,?,?,?,?,?)', args: ['o' + r.id, r.id, 'f' + r.id, '2026-10-30T03:00:00Z', r.title, 'https://x.example.org/' + r.id]});
    if (r.profile) { await prepareValues(db); await db.execute(`CREATE TABLE IF NOT EXISTS hub_content_profiles_v2(item_id TEXT PRIMARY KEY,item_version INTEGER,input_hash TEXT,profile_json TEXT,created_at TEXT,updated_at TEXT)`); await db.execute({sql: 'INSERT OR REPLACE INTO hub_content_profiles_v2 VALUES(?,?,?,?,?,?)', args: [r.id, 1, 'h', JSON.stringify({regions: ['NTB'], usefulness: ['peluang'], risk: {status: 'not_assessed'}}), '2026-10-30', '2026-10-30']}); }
  }
  await prepareValues(db);
  return db;
}

test('stage5 rubric grades radar < curated < evidence-backed from stored metadata only', () => {
  const radar = evaluateValue({...base, observations: 0, profile: null});
  assert.equal(radar.tier, 'radar');
  assert.ok(radar.score < VALUE_POLICY.curatedMinimum);
  const curated = evaluateValue({...base, editorialTitle: true, editorialCategory: true, editorialSummaryChars: 140});
  assert.equal(curated.tier, 'curated');
  assert.equal(curated.originalityStatus, 'human_edit_present');
  const strong = evaluateValue({...base, observations: 3, editorialTitle: true, editorialCategory: true, editorialSummaryChars: 200, corroboratingSources: 3, corroboratingNames: ['A', 'B']});
  assert.equal(strong.tier, 'evidence_backed');
  assert.ok(strong.score >= VALUE_POLICY.evidenceBackedMinimum);
  assert.equal(strong.adsenseSuitability, 'not_assessed');
  assert.equal(strong.publicationEnabled, false);
});

test('stage5 AI paraphrase alone never becomes evidence-backed or counted as added value', () => {
  const aiOnly = evaluateValue({...base, hasAiSummary: true, aiSummaryKind: 'ai', observations: 1});
  assert.notEqual(aiOnly.tier, 'evidence_backed');
  assert.equal(aiOnly.signals.aiSummaryOnly, true);
  assert.equal(aiOnly.originalityStatus, 'not_assessed');
  assert.ok(aiOnly.blockers.some(b => /Ringkasan AI saja/.test(b)));
  assert.equal(evaluateValue({...base, hasAiSummary: true, aiSummaryKind: 'ai', editorialTitle: true, editorialCategory: true, editorialSummaryChars: 300, observations: 1, corroboratingSources: 1}).tier, 'curated');
});

test('stage5 blockers keep rights, risk and identity problems out of higher tiers', () => {
  const unknownRights = evaluateValue({...base, rightsStatus: 'unknown', editorialTitle: true, editorialCategory: true, editorialSummaryChars: 200, observations: 3, corroboratingSources: 3});
  assert.equal(unknownRights.tier, 'radar');
  assert.ok(unknownRights.blockers.some(b => /Hak penggunaan/.test(b)));
  assert.equal(evaluateValue({...base, profile: {regions: ['Bali'], usefulness: [], risk: {status: 'needs_review'}}, editorialTitle: true}).tier, 'radar');
  assert.equal(evaluateValue({...base, reviewState: 'identity_review', editorialTitle: true, editorialCategory: true}).tier, 'radar');
  assert.equal(evaluateValue({...base, reviewState: 'rejected'}).tier, 'radar');
});

test('stage5 token signature detects corroboration across publishers, not duplicates of one source', () => {
  assert.deepEqual(titleTokens('Beasiswa pelajar Lombok dibuka untuk mahasiswa'), ['beasiswa', 'pelajar', 'lombok', 'dibuka', 'mahasiswa']);
  const title = 'Beasiswa pelajar Lombok dibuka pemerintah provinsi';
  return (async () => {
    const db = await fixture([
      {id: id(1), title, sourceId: 's1', sourceName: 'Media Satu', profile: true, observation: true, editorial: true},
      {id: id(2), title, sourceId: 's2', sourceName: 'Media Dua', profile: true, observation: true, editorial: true},
      {id: id(3), title, sourceId: 's1', sourceName: 'Media Satu'},
    ]);
    try {
      await valueBatch(db, '');
      const one = await getValue(db, id(1)), two = await getValue(db, id(2)), three = await getValue(db, id(3));
      assert.equal(one!.value.signals.corroboratingSources, 2);
      assert.ok(one!.value.signals.corroboratingNames.includes('Media Dua'));
      assert.equal(three!.value.signals.corroboratingSources, 0, 'duplicate item from the same publisher is not corroboration');
      assert.ok(['curated', 'evidence_backed'].includes(one!.value.tier));
      assert.equal(two!.stale, false);
      assert.equal(three!.value.tier, 'radar');
    } finally { db.close(); }
  })();
});

test('stage5 batch is idempotent, keyset cursor max 25, and never touches editorial or approval rows', async () => {
  const rows = Array.from({length: 30}, (_, i) => ({id: id(i + 1).replace(/.$/, String((i + 1) % 10)) + String(i).padStart(2, '0').slice(0, 0), title: 'Berita daerah Lombok nomor ' + i, sourceId: 's1', sourceName: 'Media Satu'}));
  const unique = rows.map((r, i) => ({...r, id: `legacy-news:00000000-0000-0000-0000-00000000${String(1000 + i)}`}));
  const db = await fixture(unique);
  try {
    const before = (await db.execute('SELECT * FROM hub_items ORDER BY id')).rows;
    assert.equal((await valueStatus(db)).stored, 0);
    const a = await valueBatch(db, '');
    assert.equal(a.processed, 25);
    assert.ok(a.nextCursor);
    const b = await valueBatch(db, a.nextCursor);
    assert.equal(b.processed, 5);
    assert.equal(b.nextCursor, null);
    assert.equal((await valueStatus(db)).stored, 30);
    const again = await valueBatch(db, '');
    assert.equal(again.changed, 0);
    assert.deepEqual((await db.execute('SELECT * FROM hub_items ORDER BY id')).rows, before);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_item_approvals')).rows[0].n), 0);
    assert.equal(Number((await db.execute('SELECT count(*) n FROM hub_publish_outbox')).rows[0].n), 0);
    assert.ok((await listValues(db, 10)).length <= 10);
    assert.equal((await valueStatus(db)).publicationEnabled, false);
  } finally { db.close(); }
});

test('stage5 stored value becomes stale when the news revision changes', async () => {
  const db = await fixture([{id: id(1), title: 'Beasiswa pelajar Lombok dibuka', sourceId: 's1', sourceName: 'Media Satu'}]);
  try {
    await valueBatch(db, '');
    assert.equal((await getValue(db, id(1)))!.stale, false);
    await db.execute({sql: 'UPDATE hub_items SET version=2 WHERE id=?', args: [id(1)]});
    assert.equal((await getValue(db, id(1)))!.stale, true);
    await valueBatch(db, '', id(1));
    assert.equal((await getValue(db, id(1)))!.stale, false);
  } finally { db.close(); }
});

test('stage5 UI shows tiers, blockers and non-guarantee warnings', () => {
  const value = evaluateValue({...base, rightsStatus: 'unknown'});
  const html = renderToStaticMarkup(React.createElement(ValueDetails, {data: {value, stale: true, stored: true, itemVersion: 1, generatedAt: '2026-10-30', current: value}}));
  assert.ok(html.includes('Radar'));
  assert.ok(html.includes('NILAI PERLU DIHITUNG ULANG'));
  assert.ok(html.includes('bukan verifikasi fakta'));
  assert.ok(html.includes('AdSense'));
  const manager = renderToStaticMarkup(React.createElement(ValueManager, {}));
  assert.ok(manager.includes('Nilai tambah editorial'));
  assert.ok(manager.includes('Parafrase AI tidak pernah menaikkan kelas'));
});
