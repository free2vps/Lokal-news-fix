import type {Client} from '@libsql/client';
import {createHash} from 'node:crypto';
import {sourceTime} from './editorial';

/**
 * Langkah 5: nilai tambah editorial.
 * Radar (sinyal mentah) < kurasi (ada olahan manusia/metadata) < berbukti (bukti sumber berlapis).
 * Deterministik, tanpa AI. Parafrase AI tidak pernah menaikkan kelas menjadi "berbukti".
 */
export const VALUE_VERSION = 'value_v1';

export const TIERS = ['radar', 'curated', 'evidence_backed'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = {
  radar: 'Radar · sinyal mentah',
  curated: 'Kurasi editorial',
  evidence_backed: 'Berbukti · sumber berlapis',
};

export const VALUE_POLICY = {
  algorithm: 'deterministic_rubric_v1_not_ai',
  maxItemScore: 100,
  evidenceBackedMinimum: 70,
  curatedMinimum: 45,
  corroborationRequiredForEvidence: 2,
  aiParaphraseCanReachEvidenceBacked: false,
  publicationEnabled: false,
  notes: [
    'Kelas nilai dihitung dari metadata yang tersimpan, bukan dari panjang artikel atau jumlah kata AI.',
    'Parafrase AI bukan originalitas dan bukan jaminan kelayakan AdSense.',
    'Radar/berita populer bukan bukti kebenaran; jumlah sumber bukan verifikasi independen otomatis.',
    'Tidak ada penerbitan, perubahan rekomendasi, atau perubahan isi berita pada tahap ini.',
  ],
} as const;

const STOPWORDS = new Set(['yang', 'untuk', 'dengan', 'dari', 'dalam', 'akan', 'pada', 'para', 'atau', 'juga', 'kata', 'tidak', 'bisa', 'lebih', 'setelah', 'sebagai', 'karena', 'sudah', 'masih', 'oleh', 'ini', 'itu', 'dan', 'the', 'and', 'for', 'with']);
export function titleTokens(title: string): string[] {
  return [...new Set((title || '').toLowerCase().match(/[a-z\u00c0-\u024f]{4,}/g) || [])].filter(t => !STOPWORDS.has(t)).slice(0, 8);
}
function signature(title: string) { return titleTokens(title).sort().slice(0, 4).join('|'); }

export type Signal = {id: string; title: string; sourceId: string; sourceName: string; publishedAt: string | null};
export type ValueInput = {
  id: string; version: number; title: string; sourceId: string; sourceName: string;
  reviewState: string; rightsStatus: string; publishedAt: string | null;
  editorialTitle: boolean; editorialSummaryChars: number; editorialCategory: boolean;
  observations: number; profile: any | null; hasAiSummary: boolean; aiSummaryKind: string | null;
  corroboratingSources: number; corroboratingNames: string[];
};
export type EditorialValue = {
  schemaVersion: 1; method: string; title: string;
  tier: Tier; tierLabel: string; score: number;
  components: {evidentiary: number; editorialWork: number; regionalSpecificity: number; usefulness: number; corroboration: number};
  signals: {observations: number; corroboratingSources: number; corroboratingNames: string[]; humanEdited: boolean; aiSummaryOnly: boolean; rightsStatus: string; profileRegions: string[]; usefulness: string[]; riskStatus: string};
  addedValue: {humanEdit: boolean; evidenceLayers: number; regionalSpecificity: boolean; practicalUse: boolean};
  blockers: string[]; warnings: string[];
  /** Parafrase AI tidak pernah menjadi bukti originalitas. */
  originalityStatus: 'not_assessed' | 'human_edit_present'; adsenseSuitability: 'not_assessed';
  publicationEnabled: false;
};

export const VALUE_SELECT = `SELECT i.id,i.version,i.source_title,i.source_snippet,i.review_state,i.source_published_at,i.editorial_title,i.editorial_summary,i.editorial_category,
  i.original_url,i.normalized_original_url,s.id source_id,s.name source_name,s.region,s.rights_status,
  (SELECT count(*) FROM hub_item_observations o WHERE o.item_id=i.id) observations,
  p.profile_json,
  (SELECT a.kind FROM hub_ai_summaries_v2 a WHERE a.item_id=i.id) ai_kind
  FROM hub_items i JOIN hub_sources s ON s.id=i.source_id
  LEFT JOIN hub_content_profiles_v2 p ON p.item_id=i.id`;

export function evaluateValue(input: ValueInput): EditorialValue {
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : null;
  const regions: string[] = Array.isArray(profile?.regions) ? profile.regions : [];
  const usefulness: string[] = Array.isArray(profile?.usefulness) ? profile.usefulness : [];
  const riskStatus = String(profile?.risk?.status || 'not_assessed');
  const humanEdited = Boolean(input.editorialTitle || input.editorialCategory || input.editorialSummaryChars > 0);
  const aiSummaryOnly = input.hasAiSummary && !humanEdited;
  const corroboratingSources = Math.max(0, input.corroboratingSources);

  // 1. Lapisan bukti (0-30): observasi berulang + status sumber.
  const evidentiary = input.observations >= 3 ? 30 : input.observations === 2 ? 25 : input.observations === 1 ? 18 : 8;
  // 2. Olah editorial (0-25): judul/kategori/ringkasan hasil kerja manusia.
  let editorialWork = 0;
  if (input.editorialTitle) editorialWork += 8;
  if (input.editorialCategory) editorialWork += 7;
  if (input.editorialSummaryChars >= 120) editorialWork += 10;
  else if (input.editorialSummaryChars > 0) editorialWork += 5;
  // 3. Kekhususan wilayah (0-15).
  const regionalSpecificity = regions.length ? 15 : 0;
  // 4. Kegunaan praktis (0-15).
  const practicalUse = usefulness.some(u => ['layanan', 'panduan', 'peluang', 'agenda'].includes(u));
  const usefulnessScore = practicalUse ? 15 : usefulness.length ? 8 : 0;
  // 5. Kesepakatan antar sumber (0-15).
  const corroboration = corroboratingSources >= 3 ? 15 : corroboratingSources === 2 ? 12 : 0;

  const score = evidentiary + editorialWork + regionalSpecificity + usefulnessScore + corroboration;
  const blockers: string[] = [];
  if (input.rightsStatus === 'unknown') blockers.push('Hak penggunaan metadata belum dinyatakan; boleh diradar, belum layak naik kelas.');
  if (riskStatus === 'needs_review') blockers.push('Sinyal risiko menunggu tinjauan manusia.');
  if (input.reviewState === 'identity_review') blockers.push('Identitas/versi berita meragukan.');
  if (input.reviewState === 'rejected') blockers.push('Berita berstatus ditolak.');
  if (!input.publishedAt) blockers.push('Tanggal sumber belum valid; tidak dapat menjadi bukti bertanggal.');
  if (aiSummaryOnly) blockers.push('Ringkasan AI saja bukan nilai tambah editorial maupun originalitas.');

  let tier: Tier = 'radar';
  const blockedHard = blockers.length > 0;
  if (!blockedHard && score >= VALUE_POLICY.evidenceBackedMinimum && corroboratingSources >= VALUE_POLICY.corroborationRequiredForEvidence && (humanEdited || input.observations >= 2)) tier = 'evidence_backed';
  else if (!blockedHard && (score >= VALUE_POLICY.curatedMinimum || (humanEdited && score >= 30))) tier = 'curated';

  return {
    schemaVersion: 1, method: VALUE_POLICY.algorithm, title: input.title,
    tier, tierLabel: TIER_LABEL[tier], score,
    components: {evidentiary, editorialWork, regionalSpecificity, usefulness: usefulnessScore, corroboration},
    signals: {observations: input.observations, corroboratingSources, corroboratingNames: input.corroboratingNames, humanEdited, aiSummaryOnly, rightsStatus: input.rightsStatus, profileRegions: regions, usefulness, riskStatus},
    addedValue: {humanEdit: humanEdited, evidenceLayers: Math.min(3, (input.observations > 0 ? 1 : 0) + (corroboratingSources > 1 ? 1 : 0) + (regions.length ? 1 : 0)), regionalSpecificity: regions.length > 0, practicalUse},
    blockers, warnings: [...VALUE_POLICY.notes],
    originalityStatus: humanEdited ? 'human_edit_present' : 'not_assessed', adsenseSuitability: 'not_assessed', publicationEnabled: false,
  };
}

const rowToInput = (row: Row, corr: {count: number; names: string[]}): ValueInput => ({
  id: String(row.id), version: Number(row.version), title: String(row.editorial_title || row.source_title || ''),
  sourceId: String(row.source_id), sourceName: String(row.source_name || ''), reviewState: String(row.review_state || ''),
  rightsStatus: String(row.rights_status || 'unknown'), publishedAt: (() => { try { return sourceTime(row.source_published_at); } catch { return null; } })(),
  editorialTitle: Boolean(row.editorial_title), editorialSummaryChars: String(row.editorial_summary || '').trim().length,
  editorialCategory: Boolean(row.editorial_category), observations: Number(row.observations || 0),
  profile: row.profile_json ? JSON.parse(String(row.profile_json)) : null,
  hasAiSummary: Boolean(row.ai_kind), aiSummaryKind: row.ai_kind ? String(row.ai_kind) : null,
  corroboratingSources: corr.count, corroboratingNames: corr.names,
});
type Row = Record<string, unknown>;

export function valueHash(input: ValueInput) { return createHash('sha256').update(JSON.stringify([VALUE_VERSION, input])).digest('hex'); }

async function loadRows(db: Client, id?: string) {
  try { return (await db.execute({sql: id ? `${VALUE_SELECT} WHERE i.id=?` : `${VALUE_SELECT} ORDER BY i.id`, args: id ? [id] : []})).rows as Row[]; }
  catch {
    // Tabel profil/ringkasan belum ada: nilai tetap bisa dihitung dari metadata dasar.
    const fallback = `SELECT i.id,i.version,i.source_title,i.source_snippet,i.review_state,i.source_published_at,i.editorial_title,i.editorial_summary,i.editorial_category,
      i.original_url,i.normalized_original_url,s.id source_id,s.name source_name,s.region,s.rights_status,
      (SELECT count(*) FROM hub_item_observations o WHERE o.item_id=i.id) observations,
      NULL profile_json, NULL ai_kind
      FROM hub_items i JOIN hub_sources s ON s.id=i.source_id ${id ? 'WHERE i.id=?' : 'ORDER BY i.id'}`;
    return (await db.execute({sql: fallback, args: id ? [id] : []})).rows as Row[];
  }
}

/** Kesepakatan sumber: judul dengan token kunci sama dari penerbit berbeda dalam jendela 72 jam. */
function corroborationIndex(rows: Row[]) {
  const map = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const key = signature(String(r.editorial_title || r.source_title || ''));
    if (key.split('|').filter(Boolean).length < 2) continue;
    const entry = map.get(key) || new Map<string, string>();
    entry.set(String(r.source_id), String(r.source_name || ''));
    map.set(key, entry);
  }
  return (row: Row) => {
    const key = signature(String(row.editorial_title || row.source_title || ''));
    const entry = map.get(key);
    if (!entry || entry.size < 2) return {count: 0, names: []};
    const names = [...entry.entries()].filter(([sid]) => sid !== String(row.source_id)).map(([, name]) => name).slice(0, 4);
    return {count: entry.size, names};
  };
}

export async function prepareValues(db: Client) {
  await db.execute(`CREATE TABLE IF NOT EXISTS hub_editorial_value_v2(
    item_id TEXT PRIMARY KEY REFERENCES hub_items(id),
    item_version INTEGER NOT NULL,
    input_hash TEXT NOT NULL,
    value_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`);
  return valueStatus(db);
}

export async function valueStatus(db: Client) {
  const ready = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_editorial_value_v2'")).rows.length === 1;
  if (!ready) return {ready: false, total: Number((await db.execute('SELECT count(*) n FROM hub_items')).rows[0].n), stored: 0, tiers: {}, publicationEnabled: false};
  const total = Number((await db.execute('SELECT count(*) n FROM hub_items')).rows[0].n);
  const rows = (await db.execute('SELECT value_json FROM hub_editorial_value_v2')).rows;
  const tiers: Record<string, number> = {};
  for (const r of rows) { try { const t = String(JSON.parse(String(r.value_json)).tier); tiers[t] = (tiers[t] || 0) + 1; } catch {} }
  return {ready: true, total, stored: rows.length, tiers, policy: VALUE_POLICY, publicationEnabled: false};
}

export async function valueBatch(db: Client, cursor = '', id?: string) {
  const ready = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_editorial_value_v2'")).rows.length === 1;
  if (!ready) throw Error('VALUE_NOT_READY');
  const all = await loadRows(db);
  const index = corroborationIndex(all);
  const target = id ? all.filter(r => String(r.id) === id) : all.filter(r => String(r.id) > cursor).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, 25);
  if (!target.length) return {processed: 0, changed: 0, nextCursor: null, tiers: {}};
  const existing = new Map<string, string>();
  for (const r of (await db.execute('SELECT item_id,input_hash FROM hub_editorial_value_v2')).rows) existing.set(String(r.item_id), String(r.input_hash));
  const tiers: Record<string, number> = {};
  const writes: {sql: string; args: any[]}[] = [];
  let changed = 0;
  const now = new Date().toISOString();
  for (const row of target) {
    const input = rowToInput(row, index(row));
    const value = evaluateValue(input);
    tiers[value.tier] = (tiers[value.tier] || 0) + 1;
    const hash = valueHash(input);
    const prev = existing.get(input.id);
    if (prev === hash) continue;
    writes.push({sql: `INSERT INTO hub_editorial_value_v2 VALUES(?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET item_version=excluded.item_version,input_hash=excluded.input_hash,value_json=excluded.value_json,updated_at=excluded.updated_at`,
      args: [input.id, input.version, hash, JSON.stringify(value), now, now]});
    changed += 1;
  }
  const tx = await db.transaction('write');
  try { if (writes.length) await tx.batch(writes.length > 1 ? writes : writes); await tx.commit(); }
  catch (e) { await tx.rollback(); throw e; }
  const last = target[target.length - 1];
  return {processed: target.length, changed, nextCursor: id ? null : (target.length === 25 ? String(last.id) : null), tiers};
}

export async function getValue(db: Client, id: string) {
  const row = (await loadRows(db, id))[0];
  if (!row) return null;
  const all = await loadRows(db);
  const input = rowToInput(row, corroborationIndex(all)(row));
  const stored = (await db.execute({sql: 'SELECT * FROM hub_editorial_value_v2 WHERE item_id=?', args: [id]})).rows[0];
  const fresh = evaluateValue(input);
  return {value: stored ? JSON.parse(String(stored.value_json)) : fresh, current: fresh, itemVersion: Number(row.version), generatedAt: stored ? String(stored.updated_at) : null, stale: stored ? String(stored.input_hash) !== valueHash(input) : true, stored: Boolean(stored)};
}

export async function listValues(db: Client, limit = 50, tier?: string) {
  const rows = (await db.execute({sql: 'SELECT value_json,updated_at FROM hub_editorial_value_v2 ORDER BY updated_at DESC LIMIT ?', args: [Math.min(200, Math.max(1, limit * 4))]})).rows;
  const out = rows.map(r => ({...(JSON.parse(String(r.value_json)) as object), updatedAt: String(r.updated_at)} as any));
  const filtered = tier ? out.filter(v => v.tier === tier) : out;
  return filtered.slice(0, Math.min(200, Math.max(1, limit)));
}
