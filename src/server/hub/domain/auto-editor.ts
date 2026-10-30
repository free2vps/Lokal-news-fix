import {createHash, randomUUID} from 'node:crypto';
import type {Client} from '@libsql/client';
import {extractiveSummary, normalizeText, runSummaryBatch, applySummary, summaryStatus} from './ai-summary';
import {valueBatch, valueStatus, TIER_LABEL} from './editorial-value';
import {profileBatch, profileStatus} from './content-profile';
import {syncRss} from './rss-runtime';
import {defaultDeliver, type Deliver} from './publish-policy';
import {enqueuePublished, socialReady} from './social-pull';
import {sourceTime} from './editorial';

/**
 * Tahap 10 — Redaktur Otomatis.
 *
 * Satu pipeline: tarik RSS -> saring -> buat ringkasan/poin penting -> nilai -> pilih -> terbit.
 * Bawaan MATI. Bila dinyalakan, keputusan terbit diambil aturan + ringkasan ekstraktif (gratis);
 * AI hanya dipakai untuk berita prioritas Bali/NTB/NTT dalam batas kuota harian.
 * Yang tidak pernah dilakukan: mengarang isi, menyalin fulltext, menghapus edit manual.
 */
export const AUTO_EDITOR_POLICY = {
  maxPerRun: 8,
  hardMaxPerRun: 12,
  maxPerDay: 40,
  hardMaxPerDay: 60,
  windowHours: 48,
  minTier: 'curated' as const,
  regions: ['Bali', 'NTB', 'NTT'],
  rightsMode: 'permission_confirmed' as const,
  aiPerRun: 3,
  rssSourcesPerRun: 25,
  batchesPerRun: 2,
  budgetMs: 60000,
  bulletsMax: 3,
  humansKeepEdits: true,
  fulltextRehosted: false,
  publicationAuto: true,
} as const;

export type AutoConfig = {
  enabled: boolean;
  maxPerRun: number; maxPerDay: number; windowHours: number;
  minTier: 'radar' | 'curated' | 'evidence_backed';
  regions: string[];
  rightsMode: 'permission_confirmed' | 'metadata_only';
  aiPriorityOnly: boolean;
  aiPerRun: number;
  updatedAt: string | null; updatedBy: string | null;
};

export const DEFAULT_AUTO_CONFIG: AutoConfig = {
  enabled: false,
  maxPerRun: AUTO_EDITOR_POLICY.maxPerRun,
  maxPerDay: AUTO_EDITOR_POLICY.maxPerDay,
  windowHours: AUTO_EDITOR_POLICY.windowHours,
  minTier: AUTO_EDITOR_POLICY.minTier,
  regions: [...AUTO_EDITOR_POLICY.regions],
  rightsMode: AUTO_EDITOR_POLICY.rightsMode,
  aiPriorityOnly: true,
  aiPerRun: AUTO_EDITOR_POLICY.aiPerRun,
  updatedAt: null, updatedBy: null,
};

const TIER_RANK: Record<string, number> = {radar: 0, curated: 1, evidence_backed: 2};
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const parse = (raw: unknown) => { try { return raw ? JSON.parse(String(raw)) : null; } catch { return null; } };

export async function prepareAutoEditor(db: Client) {
  await db.execute(`CREATE TABLE IF NOT EXISTS hub_auto_editor_config_v2(
    id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
    max_per_run INTEGER NOT NULL DEFAULT 8, max_per_day INTEGER NOT NULL DEFAULT 40,
    window_hours INTEGER NOT NULL DEFAULT 48, min_tier TEXT NOT NULL DEFAULT 'curated',
    regions_json TEXT NOT NULL DEFAULT '["Bali","NTB","NTT"]', rights_mode TEXT NOT NULL DEFAULT 'permission_confirmed',
    ai_priority_only INTEGER NOT NULL DEFAULT 1, ai_per_run INTEGER NOT NULL DEFAULT 3,
    updated_at TEXT, updated_by TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS hub_auto_editorial_v2(
    item_id TEXT NOT NULL, item_version INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
    bullets_json TEXT NOT NULL, method TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(item_id,item_version))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS hub_auto_editor_runs_v2(
    id TEXT PRIMARY KEY, trigger TEXT NOT NULL, status TEXT NOT NULL, steps_json TEXT NOT NULL,
    pulled INTEGER NOT NULL DEFAULT 0, selected INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  await db.execute("INSERT OR IGNORE INTO hub_auto_editor_config_v2(id,enabled) VALUES('default',0)");
  return {...await autoEditorStatus(db), dependencies: await prepareDependencies(db)};
}

/**
 * Tabel pendukung yang dibutuhkan pipeline. Tanpa tabel nilai, semua berita dianggap "radar"
 * sehingga kriteria kelas minimum tidak bermakna; tanpa tabel ringkasan, langkah AI dilewati.
 * Semua bersifat CREATE TABLE IF NOT EXISTS — tidak mengaktifkan apa pun.
 */
export async function prepareDependencies(db: Client) {
  const out: {name: string; ok: boolean; detail: string}[] = [];
  const steps: [string, () => Promise<unknown>][] = [
    ['profiles', async () => (await import('./content-profile')).prepareProfiles(db)],
    ['values', async () => (await import('./editorial-value')).prepareValues(db)],
    ['summaries', async () => (await import('./ai-summary')).prepareSummarySchema(db)],
    ['autopublish', async () => (await import('./publish-policy')).preparePublishSchema(db)],
    ['social', async () => (await import('./social-pull')).prepareSocialSchema(db)],
  ];
  for (const [name, fn] of steps) {
    try { await fn(); out.push({name, ok: true, detail: 'siap'}); }
    catch (e) { out.push({name, ok: false, detail: (e as Error).message.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)}); }
  }
  return out;
}

export async function autoEditorReady(db: Client) {
  return (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_auto_editor_runs_v2'")).rows.length === 1;
}

export async function readAutoConfig(db: Client): Promise<AutoConfig> {
  if (!(await autoEditorReady(db))) return {...DEFAULT_AUTO_CONFIG};
  const r = (await db.execute("SELECT * FROM hub_auto_editor_config_v2 WHERE id='default'")).rows[0];
  if (!r) return {...DEFAULT_AUTO_CONFIG};
  const regions = parse(r.regions_json);
  return {
    enabled: Number(r.enabled) === 1,
    maxPerRun: clamp(r.max_per_run, 1, AUTO_EDITOR_POLICY.hardMaxPerRun, DEFAULT_AUTO_CONFIG.maxPerRun),
    maxPerDay: clamp(r.max_per_day, 1, AUTO_EDITOR_POLICY.hardMaxPerDay, DEFAULT_AUTO_CONFIG.maxPerDay),
    windowHours: clamp(r.window_hours, 1, 168, DEFAULT_AUTO_CONFIG.windowHours),
    minTier: (['radar', 'curated', 'evidence_backed'].includes(String(r.min_tier)) ? String(r.min_tier) : DEFAULT_AUTO_CONFIG.minTier) as AutoConfig['minTier'],
    regions: Array.isArray(regions) ? regions.map(String) : [...AUTO_EDITOR_POLICY.regions],
    rightsMode: String(r.rights_mode) === 'metadata_only' ? 'metadata_only' : 'permission_confirmed',
    aiPriorityOnly: Number(r.ai_priority_only) !== 0,
    aiPerRun: clamp(r.ai_per_run, 0, 5, DEFAULT_AUTO_CONFIG.aiPerRun),
    updatedAt: r.updated_at ? String(r.updated_at) : null,
    updatedBy: r.updated_by ? String(r.updated_by) : null,
  };
}

export async function saveAutoConfig(db: Client, patch: Record<string, unknown>, actor: string, now = Date.now()) {
  if (!(await autoEditorReady(db))) throw Error('AUTO_EDITOR_NOT_READY');
  const cur = await readAutoConfig(db);
  const next: AutoConfig = {
    ...cur,
    maxPerRun: patch.maxPerRun === undefined ? cur.maxPerRun : clamp(patch.maxPerRun, 1, AUTO_EDITOR_POLICY.hardMaxPerRun, cur.maxPerRun),
    maxPerDay: patch.maxPerDay === undefined ? cur.maxPerDay : clamp(patch.maxPerDay, 1, AUTO_EDITOR_POLICY.hardMaxPerDay, cur.maxPerDay),
    windowHours: patch.windowHours === undefined ? cur.windowHours : clamp(patch.windowHours, 1, 168, cur.windowHours),
    minTier: ['radar', 'curated', 'evidence_backed'].includes(String(patch.minTier)) ? patch.minTier as AutoConfig['minTier'] : cur.minTier,
    regions: Array.isArray(patch.regions) ? patch.regions.map(String).filter(r => ['Bali', 'NTB', 'NTT'].includes(r)) : cur.regions,
    aiPerRun: patch.aiPerRun === undefined ? cur.aiPerRun : clamp(patch.aiPerRun, 0, 5, cur.aiPerRun),
    updatedAt: new Date(now).toISOString(), updatedBy: actor.slice(0, 100),
  };
  if (!next.regions.length) next.regions = [...AUTO_EDITOR_POLICY.regions];
  await db.execute({sql: `UPDATE hub_auto_editor_config_v2 SET max_per_run=?,max_per_day=?,window_hours=?,min_tier=?,regions_json=?,ai_priority_only=?,ai_per_run=?,updated_at=?,updated_by=? WHERE id='default'`,
    args: [next.maxPerRun, next.maxPerDay, next.windowHours, next.minTier, JSON.stringify(next.regions), next.aiPriorityOnly ? 1 : 0, next.aiPerRun, next.updatedAt, next.updatedBy]});
  return next;
}

/** Saklar utama. Menyalakan butuh konfirmasi teks; mematikan selalu boleh. */
export async function setAutoEditor(db: Client, enable: unknown, confirm: unknown, actor: string, now = Date.now()) {
  if (!(await autoEditorReady(db))) throw Error('AUTO_EDITOR_NOT_READY');
  const on = enable === true;
  if (on && String(confirm || '') !== 'AKTIFKAN REDAKTUR OTOMATIS') throw Error('CONFIRM_REQUIRED');
  await db.execute({sql: "UPDATE hub_auto_editor_config_v2 SET enabled=?,updated_at=?,updated_by=? WHERE id='default'",
    args: [on ? 1 : 0, new Date(now).toISOString(), actor.slice(0, 100)]});
  return readAutoConfig(db);
}

/** Mode hak: bawaan hanya sumber dengan hak terkonfirmasi. Mode headline butuh konfirmasi terpisah. */
export async function setRightsMode(db: Client, mode: unknown, confirm: unknown, actor: string, now = Date.now()) {
  if (!(await autoEditorReady(db))) throw Error('AUTO_EDITOR_NOT_READY');
  const next = String(mode) === 'metadata_only' ? 'metadata_only' : 'permission_confirmed';
  if (next === 'metadata_only' && String(confirm || '') !== 'AKTIFKAN MODE HEADLINE') throw Error('CONFIRM_REQUIRED');
  await db.execute({sql: "UPDATE hub_auto_editor_config_v2 SET rights_mode=?,updated_at=?,updated_by=? WHERE id='default'",
    args: [next, new Date(now).toISOString(), actor.slice(0, 100)]});
  // Mengubah dasar hak = mematikan redaktur; harus dinyalakan ulang secara sadar.
  await db.execute("UPDATE hub_auto_editor_config_v2 SET enabled=0 WHERE id='default'");
  return readAutoConfig(db);
}

/** Poin penting: kalimat sumber apa adanya, tanpa menambah fakta. */
export function keyPoints(snippet: string, max = AUTO_EDITOR_POLICY.bulletsMax) {
  const text = normalizeText(snippet, 2000);
  if (!text) return [] as string[];
  const parts = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 35 && s.length <= 220);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase().slice(0, 60);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

type Candidate = {
  id: string; version: number; title: string; summary: string; bullets: string[]; method: 'manual' | 'extractive' | 'ai';
  url: string; publishedAt: string; category: string | null; region: string; regions: string[];
  tier: string; sourceId: string; sourceName: string; rights: string; snippet: string; dateRaw: string | null; priority: boolean;
};

export type PullSource = {id: string; name: string; ok: boolean; inserted: number; error?: string};
export type StepResult = {step: string; ok: boolean; detail: string; count?: number; sources?: PullSource[]};
export type RunOptions = {
  now?: number; trigger?: string; deliver?: Deliver; master?: string;
  maxSources?: number; budgetMs?: number; skipPull?: boolean;
};

export async function runAutoEditor(db: Client, opts: RunOptions = {}) {
  const started = Date.now();
  const now = opts.now ?? started;
  const steps: StepResult[] = [];
  const push = (step: string, ok: boolean, detail: string, count?: number) => { steps.push({step, ok, detail, count} as StepResult); };
  const cfg = await readAutoConfig(db);
  if (!cfg.enabled) {
    return {status: 'disabled', runAt: new Date(now).toISOString(), durationMs: 0, steps: [{step: 'switch', ok: true, detail: 'Redaktur otomatis NONAKTIF — tidak ada yang ditarik, tidak ada yang terbit', count: 0}] as StepResult[],
      pulled: 0, candidates: 0, selected: 0, published: 0, duplicates: 0, failed: 0, reasons: {} as Record<string, number>, config: cfg, approvalRemainsHuman: false, autoPublication: true};
  }

  // 1. Tarik semua sumber RSS aktif yang haknya sudah jelas.
  let pulled = 0;
  if (!opts.skipPull) {
    const budget = opts.budgetMs ?? AUTO_EDITOR_POLICY.budgetMs;
    try {
      const sources = (await db.execute({sql: "SELECT id,name,rights_status FROM hub_sources WHERE source_kind='rss' AND is_active=1 AND discovered_type='rss' AND feed_url IS NOT NULL AND rights_status!='unknown' ORDER BY updated_at DESC", args: []})).rows;
      const limit = clamp(opts.maxSources, 1, 60, AUTO_EDITOR_POLICY.rssSourcesPerRun);
      let ok = 0, fail = 0, scanned = 0;
      const perSource: PullSource[] = [];
      for (const s of sources.slice(0, limit)) {
        if (Date.now() - started > budget) break;
        scanned += 1;
        try {
          const r = await syncRss(db, String(s.id));
          const inserted = Number((r as {count?: number})?.count || 0);
          pulled += inserted; ok += 1;
          perSource.push({id: String(s.id), name: String(s.name || ''), ok: true, inserted});
        } catch (e) {
          fail += 1;
          const code = (e instanceof Error ? e.message : '').replace(/[^A-Z0-9_]/g, '').slice(0, 40) || 'RSS_ERROR';
          perSource.push({id: String(s.id), name: String(s.name || ''), ok: false, inserted: 0, error: code});
        }
      }
      const zero = perSource.filter(x => x.ok && x.inserted === 0).length;
      const detail = sources.length
        ? `${scanned}/${sources.length} sumber diperiksa, ${pulled} berita baru${zero ? `, ${zero} tanpa berita baru` : ''}${fail ? `, ${fail} gagal` : ''}`
        : 'Belum ada sumber RSS aktif dengan hak yang jelas — tidak ada yang ditarik';
      steps.push({step: 'pull', ok: true, detail, count: pulled, sources: perSource});
    } catch { push('pull', false, 'Gagal membaca daftar sumber', 0); }
  }

  // 2-3. Profil & nilai (dipakai untuk kriteria wilayah dan kelas kelayakan).
  try {
    if ((await profileStatus(db)).ready) {
      for (let i = 0; i < AUTO_EDITOR_POLICY.batchesPerRun; i++) { const r = await profileBatch(db, ''); if (!r.processed) break; }
      push('profiles', true, 'Profil wilayah/risiko diperbarui', 0);
    } else push('profiles', false, 'Tabel profil belum disiapkan — wilayah memakai wilayah sumber', 0);
  } catch { push('profiles', false, 'Profil dilewati', 0); }
  try {
    if ((await valueStatus(db)).ready) {
      for (let i = 0; i < AUTO_EDITOR_POLICY.batchesPerRun; i++) { const r = await valueBatch(db, ''); if (!r.processed) break; }
      push('values', true, `Kelas kelayakan diperbarui (batas minimum: ${TIER_LABEL[cfg.minTier]})`, 0);
    } else push('values', false, 'Tabel nilai belum disiapkan — semua berita dianggap radar', 0);
  } catch { push('values', false, 'Penilaian dilewati', 0); }

  // 4. AI hanya untuk prioritas, dalam batas kuota (bila kunci tersedia).
  let aiApplied = 0;
  if (cfg.aiPerRun > 0) {
    try {
      if ((await summaryStatus(db)).ready) {
        const out = await runSummaryBatch(db, {maxItems: cfg.aiPerRun, freshnessHours: cfg.windowHours, master: opts.master, now, includeEditorial: false});
        for (const r of (out as unknown as {items?: {id: string; version: number; kind: string}[]}).items || []) {
          if (r.kind !== 'ai') continue;
          try { await applySummary(db, r.id, r.version, now); aiApplied += 1; } catch { /* editorial sudah ada: pertahankan */ }
        }
        push('ai', true, aiApplied ? `${aiApplied} ringkasan AI diterapkan (prioritas)` : 'Tidak ada berita prioritas yang butuh AI', aiApplied);
      } else push('ai', false, 'Tabel ringkasan belum disiapkan — memakai ringkasan ekstraktif', 0);
    } catch (e) { push('ai', false, `AI dilewati (${(e as Error).message.replace(/[^A-Z_]/g, '').slice(0, 40) || 'belum siap'}) — memakai ekstraktif`, 0); }
  } else push('ai', true, 'AI dimatikan pada konfigurasi', 0);

  // 5. Susun kandidat + teks editorial otomatis (edit manual tidak pernah ditimpa).
  const reasons: Record<string, number> = {};
  const exclude = (c: string) => { reasons[c] = (reasons[c] || 0) + 1; };
  const sources = new Map<string, {name: string; region: string; rights: string}>();
  for (const s of (await db.execute('SELECT id,name,region,rights_status FROM hub_sources')).rows) {
    sources.set(String(s.id), {name: String(s.name || ''), region: String(s.region || ''), rights: String(s.rights_status || 'unknown')});
  }
  const open = new Set<string>();
  try { for (const r of (await db.execute("SELECT item_id FROM hub_publish_outbox WHERE status IN ('queued','sending','published','duplicate')")).rows) open.add(String(r.item_id)); } catch { /* outbox belum ada */ }

  // Panel tahap lain mungkin belum disiapkan; kueri tetap jalan tanpa tabel profil/nilai.
  let rows: Record<string, unknown>[];
  try {
    rows = (await db.execute(`SELECT i.id,i.version,i.source_id,i.original_url,i.source_title,i.source_snippet,i.source_published_at,i.source_date_raw,
        i.editorial_title,i.editorial_summary,i.editorial_category,p.profile_json,v.value_json
      FROM hub_items i LEFT JOIN hub_content_profiles_v2 p ON p.item_id=i.id LEFT JOIN hub_editorial_value_v2 v ON v.item_id=i.id`)).rows as unknown as Record<string, unknown>[];
  } catch {
    rows = (await db.execute(`SELECT i.id,i.version,i.source_id,i.original_url,i.source_title,i.source_snippet,i.source_published_at,i.source_date_raw,
        i.editorial_title,i.editorial_summary,i.editorial_category,NULL profile_json,NULL value_json FROM hub_items i`)).rows as unknown as Record<string, unknown>[];
  }

  const candidates: Candidate[] = [];
  let freshWindow = 0;
  for (const row of rows) {
    const id = String(row.id), version = Number(row.version);
    const src = sources.get(String(row.source_id));
    if (!src) { exclude('source_missing'); continue; }
    if (open.has(id)) { exclude('already_in_outbox'); continue; }
    let stamp: string | null = null;
    try { stamp = sourceTime(row.source_published_at); } catch { stamp = null; }
    const t = stamp ? Date.parse(stamp) : NaN;
    if (!Number.isFinite(t) || t > now + 300000 || t < now - cfg.windowHours * 3600000) { exclude('date_outside_window'); continue; }
    freshWindow += 1;
    if (src.rights === 'unknown') { exclude('rights_unknown'); continue; }
    if (cfg.rightsMode === 'permission_confirmed' && src.rights !== 'permission_confirmed') { exclude('rights_not_permission_confirmed'); continue; }
    const profile = parse(row.profile_json);
    if (profile?.risk?.status === 'needs_review') { exclude('risk_needs_review'); continue; }
    const value = parse(row.value_json);
    const tier = value?.tier ? String(value.tier) : 'radar';
    if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[cfg.minTier] ?? 1)) { exclude('value_tier_below_minimum'); continue; }
    if (value?.stale === true) { exclude('value_stale'); continue; }
    const profileRegions: string[] = Array.isArray(profile?.regions) ? profile.regions.map(String) : [];
    const regions = profileRegions.length ? profileRegions : (src.region ? [src.region] : []);
    if (!regions.some(r => cfg.regions.includes(r))) { exclude('region_not_allowlisted'); continue; }

    const manualTitle = normalizeText(row.editorial_title, 240);
    const manualSummary = normalizeText(row.editorial_summary, 1200);
    const snippet = String(row.source_snippet || '');
    const title = manualTitle || normalizeText(row.source_title, 240);
    const summary = manualSummary || extractiveSummary(snippet || title, 420);
    if (!title || !summary) { exclude('text_missing'); continue; }
    const method: Candidate['method'] = manualTitle && manualSummary ? 'manual' : 'extractive';
    candidates.push({
      id, version, title, summary, bullets: keyPoints(snippet), method,
      url: String(row.original_url || ''), publishedAt: String(stamp), category: row.editorial_category ? String(row.editorial_category) : null,
      region: regions[0], regions, tier, sourceId: String(row.source_id), sourceName: src.name, rights: src.rights,
      snippet, dateRaw: row.source_date_raw ? String(row.source_date_raw) : null,
      priority: regions.some(r => (AUTO_EDITOR_POLICY.regions as readonly string[]).includes(r)),
    });
  }
  candidates.sort((a, b) => (Number(b.priority) - Number(a.priority)) || ((TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0)) || (Date.parse(b.publishedAt) - Date.parse(a.publishedAt)));

  for (const c of candidates) {
    await db.execute({sql: 'INSERT INTO hub_auto_editorial_v2(item_id,item_version,title,summary,bullets_json,method,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(item_id,item_version) DO UPDATE SET title=excluded.title,summary=excluded.summary,bullets_json=excluded.bullets_json,method=excluded.method,created_at=excluded.created_at',
      args: [c.id, c.version, c.title, c.summary, JSON.stringify(c.bullets), c.method, new Date(now).toISOString()]});
  }
  push('editorial', true, candidates.length ? `${candidates.length} berita punya judul + ringkasan${candidates.filter(c => c.method === 'manual').length ? ` (${candidates.filter(c => c.method === 'manual').length} dari edit manual)` : ''}` : 'Tidak ada berita yang lolos saringan awal', candidates.length);

  // 6. Batas harian + batas per putaran.
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  let sentToday = 0;
  try { sentToday = Number((await db.execute({sql: "SELECT count(*) n FROM hub_publish_outbox WHERE status IN ('sending','published') AND created_at>=?", args: [dayStart.toISOString()]})).rows[0].n); } catch { sentToday = 0; }
  const room = Math.max(0, cfg.maxPerDay - sentToday);
  const picked = candidates.slice(0, Math.min(cfg.maxPerRun, room));
  if (!room && candidates.length) reasons.daily_limit_reached = candidates.length;
  push('select', true, picked.length ? `${picked.length} dipilih untuk terbit (sisa kuota hari ini ${room})` : `Tidak ada yang dipilih (sisa kuota hari ini ${room})`, picked.length);

  // 7. Terbit otomatis + catat outbox (idempoten per item+versi).
  let published = 0, duplicates = 0;
  const failed: {id: string; code: string}[] = [];
  if (picked.length) {
    const deliver = opts.deliver ?? defaultDeliver();
    const claimed: Candidate[] = [];
    for (const c of picked) {
      const key = createHash('sha256').update(`auto:${c.id}:${c.version}`).digest('hex');
      const snapshot = JSON.stringify({
        id: c.id, sourceId: c.sourceId, originalUrl: c.url, sourceTitle: c.title, sourceSnippet: c.snippet,
        sourcePublishedAt: c.publishedAt, sourceDateRaw: c.dateRaw, editorialTitle: c.title, editorialSummary: c.summary,
        editorialCategory: c.category, version: c.version, autoEditorial: true, autoMethod: c.method,
      });
      // Outbox mensyaratkan baris persetujuan (item_id,version). Redaktur otomatis mencatat
      // persetujuannya sendiri dengan penanda jelas 'auto-editor' agar tetap dapat diaudit;
      // status tinjauan berita TIDAK diubah dan edit manual tidak ditimpa.
      await db.execute({sql: 'INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES(?,?,?,?,?) ON CONFLICT(item_id,version) DO NOTHING',
        args: [c.id, c.version, snapshot, new Date(now).toISOString(), 'auto-editor:' + c.method]});
      const ins = await db.execute({sql: "INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at) VALUES(?,?,?,?,?,'sending',?) ON CONFLICT(idempotency_key) DO NOTHING",
        args: [randomUUID(), key, c.id, c.version, snapshot, new Date(now).toISOString()]});
      if (ins.rowsAffected) claimed.push(c);
    }
    try {
      const result = await deliver(claimed.map(c => ({id: c.id, version: c.version, snapshot: JSON.parse(JSON.stringify({
        id: c.id, sourceId: c.sourceId, originalUrl: c.url, sourceTitle: c.title, sourceSnippet: c.snippet,
        sourcePublishedAt: c.publishedAt, sourceDateRaw: c.dateRaw, editorialTitle: c.title, editorialSummary: c.summary,
        editorialCategory: c.category, version: c.version, autoEditorial: true, autoMethod: c.method,
      }))})));
      published = result.published.length;
      duplicates = result.duplicates.length;
      failed.push(...result.failed);
      for (const id of result.published) await db.execute({sql: "UPDATE hub_publish_outbox SET status='published' WHERE item_id=? AND status='sending'", args: [id]});
      for (const id of result.duplicates) await db.execute({sql: "UPDATE hub_publish_outbox SET status='duplicate' WHERE item_id=? AND status='sending'", args: [id]});
      for (const f of result.failed) await db.execute({sql: "UPDATE hub_publish_outbox SET status='failed' WHERE item_id=? AND status='sending'", args: [f.id]});
      push('publish', failed.length === 0, `${published} terbit, ${duplicates} sudah ada, ${failed.length} gagal`, published);
    } catch (e) {
      const code = (e instanceof Error ? e.message : '').replace(/[^A-Z0-9_]/g, '').slice(0, 50) || 'PUBLISH_FAILED';
      for (const c of claimed) await db.execute({sql: "UPDATE hub_publish_outbox SET status='failed' WHERE item_id=? AND status='sending'", args: [c.id]});
      push('publish', false, `Pengiriman gagal: ${code} — 0 artikel terbit`, 0);
    }
  } else push('publish', true, 'Tidak ada yang perlu diterbitkan', 0);

  // 8. Antrean media sosial: artikel yang baru terbit langsung bisa ditarik Make
  //    dengan pemicu yang sama (maks 4 per tarikan di sisi antrean).
  try {
    if (await socialReady(db)) {
      const out = await enqueuePublished(db, now);
      push('social_queue', true, `${out.inserted} artikel masuk antrean media sosial`, out.inserted);
    } else push('social_queue', false, 'Tabel antrean sosial belum disiapkan — Facebook tidak akan menerima apa pun', 0);
  } catch { push('social_queue', false, 'Gagal mengisi antrean media sosial', 0); }

  const duration = Date.now() - started;
  const status = steps.every(s => s.ok) ? 'ok' : steps.some(s => s.ok) ? 'partial' : 'failed';
  await db.execute({sql: 'INSERT INTO hub_auto_editor_runs_v2(id,trigger,status,steps_json,pulled,selected,published,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    args: [randomUUID(), String(opts.trigger || 'manual').slice(0, 40), status, JSON.stringify(steps), pulled, picked.length, published, duration, new Date(now).toISOString()]});

  return {
    status, runAt: new Date(now).toISOString(), durationMs: duration, steps,
    pulled, candidates: candidates.length, selected: picked.length, published, duplicates, failed: failed.length,
    reasons, config: cfg, approvalRemainsHuman: false, autoPublication: true,
    note: 'Terbit otomatis: artikel masuk database situs tanpa klik persetujuan. Semua keputusan tercatat di audit.',
  };
}

export async function autoEditorStatus(db: Client) {
  const empty = {ready: false, config: {...DEFAULT_AUTO_CONFIG}, runs: [], policy: AUTO_EDITOR_POLICY, sources: {total: 0, permissionConfirmed: 0, metadataOnly: 0, unknown: 0}, publishedToday: 0, tierLabels: TIER_LABEL};
  if (!(await autoEditorReady(db))) return empty;
  const config = await readAutoConfig(db);
  const runs = (await db.execute('SELECT trigger,status,pulled,selected,published,duration_ms,created_at,steps_json FROM hub_auto_editor_runs_v2 ORDER BY created_at DESC LIMIT 8')).rows.map(r => ({
    trigger: String(r.trigger), status: String(r.status), pulled: Number(r.pulled), selected: Number(r.selected),
    published: Number(r.published), durationMs: Number(r.duration_ms), at: String(r.created_at),
    steps: parse(r.steps_json) || [],
  }));
  let sources = {total: 0, permissionConfirmed: 0, metadataOnly: 0, unknown: 0};
  try {
    const rows = (await db.execute("SELECT rights_status,count(*) n FROM hub_sources WHERE source_kind='rss' AND is_active=1 GROUP BY rights_status")).rows;
    sources = {total: rows.reduce((a, r) => a + Number(r.n), 0), permissionConfirmed: 0, metadataOnly: 0, unknown: 0};
    for (const r of rows) {
      const k = String(r.rights_status);
      if (k === 'permission_confirmed') sources.permissionConfirmed += Number(r.n);
      else if (k === 'metadata_only') sources.metadataOnly += Number(r.n);
      else sources.unknown += Number(r.n);
    }
  } catch { /* tabel sumber belum ada */ }
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  let publishedToday = 0;
  try { publishedToday = Number((await db.execute({sql: "SELECT count(*) n FROM hub_publish_outbox WHERE status='published' AND created_at>=?", args: [dayStart.toISOString()]})).rows[0].n); } catch {}
  return {ready: true, config, runs, policy: AUTO_EDITOR_POLICY, sources, publishedToday, tierLabels: TIER_LABEL};
}
