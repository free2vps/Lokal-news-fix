import type {Client} from '@libsql/client';
import {createHash, randomUUID} from 'node:crypto';
import {sourceTime} from './editorial';
import {mapHubArticle} from '@/lib/content-hub/mapping';


/**
 * Langkah 8: autopublish ber-allowlist dengan dry-run wajib.
 *
 * Pagar yang tidak bisa dilewati dari UI:
 * 1. Bawaan: nonaktif, mode dry_run, allowlist kosong.
 * 2. Setiap perubahan konfigurasi otomatis melucuti senjata (disarm).
 * 3. "Arm" hanya berlaku sekali, maksimal 15 menit, dan hanya untuk plan_hash dry-run terbaru.
 * 4. Data berubah setelah dry-run → hash tidak cocok → harus dry-run ulang.
 * 5. Per item: harus approved_version == version, hak `permission_confirmed`, bukan risiko-perlu-tinjauan,
 *    wilayah & sumber di allowlist, kelas nilai minimal, dan belum ada di outbox.
 * 6. Adapter pengiriman memerlukan kredensial tujuan backend yang terpisah; bila tidak ada, tidak ada
 *    satu baris pun yang diklaim dan outbox tetap kosong.
 */
export const PUBLISH_VERSION = 'publish_v1';
export const PUBLISH_POLICY = {
  defaultEnabled: false,
  defaultMode: 'dry_run' as const,
  armedTtlMs: 15 * 60 * 1000,
  dryRunTtlMs: 10 * 60 * 1000,
  defaultDailyMax: 5,
  hardDailyMax: 20,
  maxItemsPerRun: 5,
  requiresHumanApproval: true,
  requiresRightsPermissionConfirmed: true,
  requiresDryRunMatch: true,
  singleUseArm: true,
  configChangeDisarms: true,
  schedulerConfigured: false,
  homepageLayoutChanged: false,
  publicationEnabledByDefault: false,
  notes: [
    'Menyalakan autopublish adalah izin terpisah untuk situs Supabase/Production; panel ini tidak menyalakannya sendiri.',
    'Tidak ada perubahan beranda/layout website oleh patch ini.',
    'Dry-run tidak menulis berita, persetujuan, atau outbox; hanya mencatat rencana ke tabel audit.',
    'Dry-run bukan uji tulis ke database website; pengiriman pertama tetap harus diawasi manual.',
    'Berita yang lolos tetap bisa salah; kelas nilai dan profil bukan verifikasi fakta.',
  ],
} as const;

export type PublishConfig = {
  enabled: boolean; mode: 'dry_run' | 'live';
  scheduleEnabled: boolean; maxPerRun: number;
  allowRegions: string[]; allowSourceIds: string[]; allowCategories: string[];
  minValueTier: 'radar' | 'curated' | 'evidence_backed';
  dailyMax: number; windowHours: number;
  armedUntil: number | null; armedPlanHash: string | null;
  updatedAt: string | null; updatedBy: string | null;
};
export const DEFAULT_CONFIG: PublishConfig = {
  enabled: false, mode: 'dry_run', scheduleEnabled: false, maxPerRun: 4, allowRegions: ['Bali', 'NTB', 'NTT'], allowSourceIds: [], allowCategories: [],
  minValueTier: 'curated', dailyMax: PUBLISH_POLICY.defaultDailyMax, windowHours: 72,
  armedUntil: null, armedPlanHash: null, updatedAt: null, updatedBy: null,
};
const TIER_RANK: Record<string, number> = {radar: 0, curated: 1, evidence_backed: 2};

const PLAN_SQL = `SELECT i.id,i.version,i.review_state,i.approved_version,i.source_published_at,i.source_title,i.editorial_title,i.editorial_summary,i.editorial_category,
  i.source_snippet,i.original_url,i.source_date_raw,s.id source_id,s.name source_name,s.region,s.rights_status,
  p.profile_json, v.value_json,
  (SELECT count(*) FROM hub_publish_outbox o WHERE o.item_id=i.id AND o.approved_version=i.version AND o.status IN ('queued','sending','published')) outbox_count
  FROM hub_items i JOIN hub_sources s ON s.id=i.source_id
  LEFT JOIN hub_content_profiles_v2 p ON p.item_id=i.id
  LEFT JOIN hub_editorial_value_v2 v ON v.item_id=i.id
  WHERE i.review_state='approved' ORDER BY i.id`;

type Row = Record<string, unknown>;
const parse = (raw: unknown) => { try { return raw ? JSON.parse(String(raw)) : null; } catch { return null; } };

export async function preparePublishSchema(db: Client) {
  const tx = await db.transaction('write');
  try {
    await tx.execute(`CREATE TABLE IF NOT EXISTS hub_autopublish_v2(
      id TEXT PRIMARY KEY CHECK(id='owner'), enabled INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'dry_run',
      allow_regions TEXT NOT NULL, allow_source_ids TEXT NOT NULL, allow_categories TEXT NOT NULL,
      min_value_tier TEXT NOT NULL, daily_max INTEGER NOT NULL, window_hours INTEGER NOT NULL,
      armed_until INTEGER, armed_plan_hash TEXT, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`);
    await tx.execute({sql:`INSERT OR IGNORE INTO hub_autopublish_v2(id,enabled,mode,allow_regions,allow_source_ids,allow_categories,min_value_tier,daily_max,window_hours,updated_at,updated_by)
      VALUES('owner',0,'dry_run',?,?,?,?,?,?,?,?)`, args: [JSON.stringify(DEFAULT_CONFIG.allowRegions), JSON.stringify([]), JSON.stringify([]), DEFAULT_CONFIG.minValueTier, DEFAULT_CONFIG.dailyMax, DEFAULT_CONFIG.windowHours, new Date().toISOString(), 'init']});
    for (const sql of [
      'ALTER TABLE hub_autopublish_v2 ADD COLUMN schedule_enabled INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE hub_autopublish_v2 ADD COLUMN max_per_run INTEGER NOT NULL DEFAULT 4',
    ]) { try { await tx.execute(sql); } catch { /* kolom sudah ada */ } }
    await tx.execute(`CREATE TABLE IF NOT EXISTS hub_publish_runs_v2(
      id TEXT PRIMARY KEY, mode TEXT NOT NULL, plan_hash TEXT NOT NULL, eligible INTEGER NOT NULL,
      excluded INTEGER NOT NULL, reasons_json TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  return {config: await readConfig(db), policy: PUBLISH_POLICY};
}

export async function publishReady(db: Client) {
  return (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_autopublish_v2'")).rows.length === 1;
}

export async function readConfig(db: Client): Promise<PublishConfig> {
  if (!(await publishReady(db))) return {...DEFAULT_CONFIG};
  const r = (await db.execute("SELECT * FROM hub_autopublish_v2 WHERE id='owner'")).rows[0];
  if (!r) return {...DEFAULT_CONFIG};
  return {
    enabled: Number(r.enabled) === 1, mode: String(r.mode) === 'live' ? 'live' : 'dry_run',
    scheduleEnabled: Number(r.schedule_enabled) === 1, maxPerRun: Number(r.max_per_run) || 4,
    allowRegions: parse(r.allow_regions) || [], allowSourceIds: parse(r.allow_source_ids) || [], allowCategories: parse(r.allow_categories) || [],
    minValueTier: (String(r.min_value_tier) as PublishConfig['minValueTier']) || 'curated',
    dailyMax: Number(r.daily_max), windowHours: Number(r.window_hours),
    armedUntil: r.armed_until ? Number(r.armed_until) : null, armedPlanHash: r.armed_plan_hash ? String(r.armed_plan_hash) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : null, updatedBy: r.updated_by ? String(r.updated_by) : null,
  };
}

/** Setiap perubahan konfigurasi selalu melucuti arm (enabled=0, mode=dry_run). */
export async function updateConfig(db: Client, input: Record<string, unknown>, actor: string) {
  if (!(await publishReady(db))) throw Error('PUBLISH_NOT_READY');
  const current = await readConfig(db);
  const cleanStrings = (v: unknown, max: number, pattern: RegExp) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) throw Error('PUBLISH_CONFIG_INVALID');
    const out = [...new Set(v.map(x => String(x).trim()).filter(Boolean))];
    if (out.length > max || out.some(x => !pattern.test(x))) throw Error('PUBLISH_CONFIG_INVALID');
    return out;
  };
  const regions = cleanStrings(input.allowRegions, 3, /^(Bali|NTB|NTT)$/);
  const sources = cleanStrings(input.allowSourceIds, 100, /^[0-9a-f-]{36}$/);
  const categories = cleanStrings(input.allowCategories, 20, /^[\w &/-]{1,60}$/);
  const tier = input.minValueTier === undefined ? undefined : String(input.minValueTier);
  if (tier !== undefined && !['radar', 'curated', 'evidence_backed'].includes(tier)) throw Error('PUBLISH_CONFIG_INVALID');
  const dailyMax = input.dailyMax === undefined ? undefined : Number(input.dailyMax);
  if (dailyMax !== undefined && (!Number.isInteger(dailyMax) || dailyMax < 1 || dailyMax > PUBLISH_POLICY.hardDailyMax)) throw Error('PUBLISH_CONFIG_INVALID');
  const windowHours = input.windowHours === undefined ? undefined : Number(input.windowHours);
  if (windowHours !== undefined && (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168)) throw Error('PUBLISH_CONFIG_INVALID');
  const next: PublishConfig = {
    ...current, enabled: false, mode: 'dry_run', armedUntil: null, armedPlanHash: null, scheduleEnabled: false,
    allowRegions: regions ?? current.allowRegions, allowSourceIds: sources ?? current.allowSourceIds, allowCategories: categories ?? current.allowCategories,
    minValueTier: (tier as PublishConfig['minValueTier']) ?? current.minValueTier, dailyMax: dailyMax ?? current.dailyMax, windowHours: windowHours ?? current.windowHours,
    updatedAt: new Date().toISOString(), updatedBy: actor.slice(0, 100),
  };
  await db.execute({sql: `UPDATE hub_autopublish_v2 SET enabled=0,mode='dry_run',schedule_enabled=0,allow_regions=?,allow_source_ids=?,allow_categories=?,min_value_tier=?,daily_max=?,window_hours=?,armed_until=NULL,armed_plan_hash=NULL,updated_at=?,updated_by=? WHERE id='owner'`,
    args: [JSON.stringify(next.allowRegions), JSON.stringify(next.allowSourceIds), JSON.stringify(next.allowCategories), next.minValueTier, next.dailyMax, next.windowHours, next.updatedAt, next.updatedBy]});
  return {config: await readConfig(db), disarmed: true, scheduleDisabled: true, note: 'Perubahan konfigurasi melucuti izin sekali-pakai DAN mematikan terbit terjadwal; jalankan dry-run lalu aktifkan ulang.'};
}

export type PlanItem = {id: string; version: number; title: string; sourceId: string; sourceName: string; regions: string[]; tier: string; publishedAt: string};
export type PublishPlan = {
  planHash: string; items: PlanItem[]; eligible: number; excluded: number; reasons: Record<string, number>;
  gates: {configArmed: boolean; allowSources: number; minValueTier: string; dailyMax: number; sentToday: number; remainingToday: number};
  canArm: boolean; armBlockers: string[]; generatedAt: string;
};

export async function buildPlan(db: Client, now = Date.now()): Promise<PublishPlan> {
  const cfg = await readConfig(db);
  let rows: Row[];
  try { rows = (await db.execute(PLAN_SQL)).rows as Row[]; }
  catch { rows = (await db.execute(`SELECT i.id,i.version,i.review_state,i.approved_version,i.source_published_at,i.source_title,i.editorial_title,i.editorial_summary,i.editorial_category,i.source_snippet,i.original_url,i.source_date_raw,s.id source_id,s.name source_name,s.region,s.rights_status,NULL profile_json,NULL value_json,(SELECT count(*) FROM hub_publish_outbox o WHERE o.item_id=i.id AND o.approved_version=i.version AND o.status IN ('queued','sending','published')) outbox_count FROM hub_items i JOIN hub_sources s ON s.id=i.source_id WHERE i.review_state='approved' ORDER BY i.id`)).rows as Row[]; }
  const reasons: Record<string, number> = {};
  const items: PlanItem[] = [];
  const exclude = (code: string) => { reasons[code] = (reasons[code] || 0) + 1; };
  const openRowoutbox = new Set<string>();
  for (const q of (await db.execute("SELECT item_id FROM hub_publish_outbox WHERE status IN ('queued','sending','published')")).rows) openRowoutbox.add(String(q.item_id));

  for (const row of rows) {
    const id = String(row.id), version = Number(row.version);
    if (Number(row.approved_version) !== version) { exclude('approval_version_mismatch'); continue; }
    if (openRowoutbox.has(id) || Number(row.outbox_count) > 0) { exclude('already_in_outbox'); continue; }
    if (String(row.rights_status) !== 'permission_confirmed') { exclude('rights_not_permission_confirmed'); continue; }
    let stamp: string | null = null;
    try { stamp = sourceTime(row.source_published_at); } catch { stamp = null; }
    const t = stamp ? Date.parse(stamp) : NaN;
    if (!Number.isFinite(t) || t > now + 300000 || t < now - cfg.windowHours * 3600000) { exclude('date_outside_window'); continue; }
    const profile = parse(row.profile_json);
    if (profile?.risk?.status === 'needs_review') { exclude('risk_needs_review'); continue; }
    const value = parse(row.value_json);
    const tier = value?.tier ? String(value.tier) : 'radar';
    if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[cfg.minValueTier] ?? 1)) { exclude('value_tier_below_minimum'); continue; }
    if (value?.stale === true) { exclude('value_stale'); continue; }
    const title = String(row.editorial_title || row.source_title || '');
    const summary = String(row.editorial_summary || '');
    if (!title.trim() || !summary.trim()) { exclude('editorial_text_missing'); continue; }
    // Wilayah: profil Tahap 2 lebih dulu; bila belum ada, pakai wilayah sumber (bukan tebakan baru).
    const profileRegions: string[] = Array.isArray(profile?.regions) ? profile.regions : [];
    const sourceRegion = String(row.region || '');
    const regions: string[] = profileRegions.length ? profileRegions : (sourceRegion ? [sourceRegion] : []);
    if (cfg.allowRegions.length === 0 || !regions.some(r => cfg.allowRegions.includes(r))) { exclude('region_not_allowlisted'); continue; }
    if (!cfg.allowSourceIds.includes(String(row.source_id))) { exclude('source_not_allowlisted'); continue; }
    if (cfg.allowCategories.length && !cfg.allowCategories.includes(String(row.editorial_category || ''))) { exclude('category_not_allowlisted'); continue; }
    if (String(row.review_state) !== 'approved') { exclude('not_approved'); continue; }
    items.push({id, version, title: title.slice(0, 200), sourceId: String(row.source_id), sourceName: String(row.source_name || ''), regions, tier, publishedAt: String(stamp)});
  }

  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  let sentToday = 0;
  try { sentToday = Number((await db.execute({sql: "SELECT count(*) n FROM hub_publish_outbox WHERE status IN ('sending','published') AND created_at>=?", args: [dayStart.toISOString()]})).rows[0].n); } catch {}
  const limited = items.slice(0, Math.min(PUBLISH_POLICY.maxItemsPerRun, Math.max(0, cfg.dailyMax - sentToday)));
  const armBlockers: string[] = [];
  if (!cfg.allowSourceIds.length) armBlockers.push('Allowlist sumber masih kosong: tentukan sumber mana yang boleh terbit otomatis.');
  if (!cfg.allowRegions.length) armBlockers.push('Allowlist wilayah kosong.');
  if (!limited.length) armBlockers.push('Tidak ada kandidat yang lolos seluruh syarat saat ini.');
  const planHash = createHash('sha256').update(JSON.stringify([PUBLISH_VERSION, cfg.minValueTier, cfg.allowRegions, cfg.allowSourceIds, cfg.allowCategories, cfg.windowHours, limited.map(i => [i.id, i.version])])).digest('hex');
  return {
    planHash, items: limited, eligible: limited.length, excluded: rows.length - items.length, reasons,
    gates: {configArmed: cfg.enabled && cfg.mode === 'live' && Number(cfg.armedUntil || 0) > now, allowSources: cfg.allowSourceIds.length, minValueTier: cfg.minValueTier, dailyMax: cfg.dailyMax, sentToday, remainingToday: Math.max(0, cfg.dailyMax - sentToday)},
    canArm: armBlockers.length === 0, armBlockers, generatedAt: new Date(now).toISOString(),
  };
}

/** Dry-run hanya menulis tabel audit miliknya sendiri. */
export async function dryRun(db: Client, actor: string, now = Date.now()) {
  if (!(await publishReady(db))) throw Error('PUBLISH_NOT_READY');
  const plan = await buildPlan(db, now);
  const id = randomUUID();
  await db.execute({sql: 'INSERT INTO hub_publish_runs_v2(id,mode,plan_hash,eligible,excluded,reasons_json,actor,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
    args: [id, 'dry_run', plan.planHash, plan.eligible, plan.excluded, JSON.stringify(plan.reasons), actor.slice(0, 100), new Date(now).toISOString(), now + PUBLISH_POLICY.dryRunTtlMs]});
  return {runId: id, plan, dryRunTtlMs: PUBLISH_POLICY.dryRunTtlMs, writes: {outbox: 0, items: 0, approvals: 0}, note: 'Dry-run tidak mengirim apa pun ke website.'};
}

export async function arm(db: Client, planHash: unknown, confirm: unknown, actor: string, now = Date.now()) {
  if (!(await publishReady(db))) throw Error('PUBLISH_NOT_READY');
  if (confirm !== 'ARM AUTOPUBLISH') throw Error('PUBLISH_CONFIRM_REQUIRED');
  if (typeof planHash !== 'string' || !/^[a-f0-9]{64}$/.test(planHash)) throw Error('PUBLISH_PLAN_INVALID');
  const cfg = await readConfig(db);
  if (!cfg.allowSourceIds.length) throw Error('PUBLISH_ALLOWLIST_EMPTY');
  const recent = (await db.execute({sql: "SELECT plan_hash,expires_at FROM hub_publish_runs_v2 WHERE mode='dry_run' AND plan_hash=? ORDER BY created_at DESC LIMIT 1", args: [planHash]})).rows[0];
  if (!recent) throw Error('PUBLISH_DRYRUN_REQUIRED');
  if (Number(recent.expires_at) < now) throw Error('PUBLISH_DRYRUN_EXPIRED');
  const plan = await buildPlan(db, now);
  if (plan.planHash !== planHash) throw Error('PUBLISH_PLAN_CHANGED');
  if (!plan.items.length) throw Error('PUBLISH_PLAN_EMPTY');
  const armedUntil = now + PUBLISH_POLICY.armedTtlMs;
  await db.execute({sql: "UPDATE hub_autopublish_v2 SET enabled=1,mode='live',armed_until=?,armed_plan_hash=?,updated_at=?,updated_by=? WHERE id='owner'", args: [armedUntil, planHash, new Date(now).toISOString(), actor.slice(0, 100)]});
  return {armed: true, armedUntil, planHash, items: plan.items.length, note: 'Izin berlaku satu kali dan maksimal 15 menit. Setelah satu kali publikasi, otomatis nonaktif lagi.'};
}

export async function disarm(db: Client, actor: string, now = Date.now()) {
  if (!(await publishReady(db))) throw Error('PUBLISH_NOT_READY');
  await db.execute({sql: "UPDATE hub_autopublish_v2 SET enabled=0,mode='dry_run',armed_until=NULL,armed_plan_hash=NULL,updated_at=?,updated_by=? WHERE id='owner'", args: [new Date(now).toISOString(), actor.slice(0, 100)]});
  return {enabled: false, mode: 'dry_run'};
}

export type DeliveryResult = {published: string[]; duplicates: string[]; failed: {id: string; code: string}[]; target: string};
export type Deliver = (items: {id: string; version: number; snapshot: Record<string, unknown>}[]) => Promise<DeliveryResult>;

/** Adapter bawaan: tidak dikonfigurasi → menolak sebelum ada baris outbox yang diklaim. */
export function defaultDeliver(): Deliver {
  const fn = (async () => { throw Error('PUBLISH_TARGET_NOT_CONFIGURED'); }) as Deliver & {builtin?: boolean};
  fn.builtin = true;
  return fn;
}
export function targetConfigured() {
  return Boolean(process.env.HUB_WEBSITE_SUPABASE_URL && process.env.HUB_WEBSITE_SERVICE_ROLE_KEY);
}

export async function publishArmed(db: Client, actor: string, deliver: Deliver = defaultDeliver(), now = Date.now()) {
  if (!(await publishReady(db))) throw Error('PUBLISH_NOT_READY');
  const cfg = await readConfig(db);
  if (!cfg.enabled || cfg.mode !== 'live') throw Error('PUBLISH_NOT_ARMED');
  if (!cfg.armedUntil || cfg.armedUntil < now) { await disarm(db, 'system:expired', now); throw Error('PUBLISH_ARM_EXPIRED'); }
  // Adapter bawaan butuh kredensial backend; adapter yang disuntikkan (uji) tidak membuat jaringan.
  if (!targetConfigured() && (deliver as Deliver & {builtin?: boolean}).builtin === true) throw Error('PUBLISH_TARGET_NOT_CONFIGURED');
  const plan = await buildPlan(db, now);
  if (plan.planHash !== cfg.armedPlanHash) { await disarm(db, 'system:plan_changed', now); throw Error('PUBLISH_PLAN_CHANGED'); }
  if (!plan.items.length) { await disarm(db, 'system:empty', now); throw Error('PUBLISH_PLAN_EMPTY'); }

  const snapshots = new Map<string, Record<string, unknown>>();
  for (const item of plan.items) {
    const row = (await db.execute({sql: 'SELECT snapshot_json FROM hub_item_approvals WHERE item_id=? AND version=?', args: [item.id, item.version]})).rows[0];
    if (!row?.snapshot_json) throw Error('PUBLISH_APPROVAL_MISSING');
    snapshots.set(item.id, JSON.parse(String(row.snapshot_json)));
  }

  const claimed: string[] = [];
  for (const item of plan.items) {
    const key = createHash('sha256').update(`autopublish:${item.id}:${item.version}`).digest('hex');
    const inserted = await db.execute({sql: "INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at) VALUES(?,?,?,?,?,'sending',?) ON CONFLICT(idempotency_key) DO NOTHING",
      args: [randomUUID(), key, item.id, item.version, JSON.stringify(snapshots.get(item.id)), new Date(now).toISOString()]});
    if (inserted.rowsAffected) claimed.push(item.id);
  }

  let result: DeliveryResult = {published: [], duplicates: [], failed: [], target: 'none'};
  try {
    result = await deliver(plan.items.filter(i => claimed.includes(i.id)).map(i => ({id: i.id, version: i.version, snapshot: snapshots.get(i.id)!})));
  } catch (e) {
    const code = (e instanceof Error ? e.message : '').replace(/[^A-Z0-9_]/g, '').slice(0, 60) || 'PUBLISH_DELIVERY_FAILED';
    for (const id of claimed) await db.execute({sql: "UPDATE hub_publish_outbox SET status='failed' WHERE item_id=? AND status='sending'", args: [id]}).catch(() => {});
    await disarm(db, 'system:delivery_failed', now);
    throw Object.assign(Error(code), {deliveryCode: code});
  }

  for (const id of result.published) await db.execute({sql: "UPDATE hub_publish_outbox SET status='published' WHERE item_id=? AND status='sending'", args: [id]});
  for (const id of result.duplicates) await db.execute({sql: "UPDATE hub_publish_outbox SET status='duplicate' WHERE item_id=? AND status='sending'", args: [id]});
  for (const f of result.failed) await db.execute({sql: "UPDATE hub_publish_outbox SET status='failed' WHERE item_id=? AND status='sending'", args: [f.id]});
  await disarm(db, 'system:single_use', now);

  return {published: result.published.length, duplicates: result.duplicates.length, failed: result.failed.length, target: result.target, disarmed: true, claimed: claimed.length, note: 'Izin otomatis dicabut setelah satu kali jalan. Beranda/layout tidak diubah oleh proses ini.'};
}

/** Terbit terjadwal 3 jam: izin persisten, hanya untuk artikel yang SUDAH disetujui manusia. */
export async function setSchedule(db: Client, enable: unknown, confirm: unknown, actor: string, now = Date.now()) {
  if (!(await publishReady(db))) throw Error('PUBLISH_NOT_READY');
  const on = enable === true;
  if (on && confirm !== 'ENABLE SCHEDULE 3H') throw Error('PUBLISH_CONFIRM_REQUIRED');
  const cfg = await readConfig(db);
  if (on && !cfg.allowSourceIds.length) throw Error('PUBLISH_ALLOWLIST_EMPTY');
  await db.execute({sql: "UPDATE hub_autopublish_v2 SET schedule_enabled=?,max_per_run=?,updated_at=?,updated_by=? WHERE id='owner'",
    args: [on ? 1 : 0, Math.min(4, Math.max(1, cfg.maxPerRun)), new Date(now).toISOString(), actor.slice(0, 100)]});
  return {scheduleEnabled: on, maxPerRun: Math.min(4, Math.max(1, cfg.maxPerRun)),
    note: on
      ? 'Terbit terjadwal aktif maksimal 4 artikel/putaran dan hanya untuk artikel yang sudah disetujui + lolos semua gerbang. Persetujuan tetap manual.'
      : 'Terbit terjadwal dimatikan.'};
}

export async function publishScheduled(db: Client, actor: string, deliver: Deliver = defaultDeliver(), now = Date.now()) {
  if (!(await publishReady(db))) throw Error('PUBLISH_NOT_READY');
  const cfg = await readConfig(db);
  if (!cfg.scheduleEnabled) return {published: 0, duplicates: 0, failed: 0, skipped: true, reason: 'schedule_disabled', target: 'none'};
  if (!cfg.allowSourceIds.length) return {published: 0, duplicates: 0, failed: 0, skipped: true, reason: 'allowlist_empty', target: 'none'};
  if (!targetConfigured() && (deliver as Deliver & {builtin?: boolean}).builtin === true) return {published: 0, duplicates: 0, failed: 0, skipped: true, reason: 'target_not_configured', target: 'none'};
  const plan = await buildPlan(db, now);
  if (!plan.items.length) return {published: 0, duplicates: 0, failed: 0, skipped: true, reason: 'no_eligible', target: 'none'};
  const items = plan.items.slice(0, Math.min(4, Math.max(1, cfg.maxPerRun)));
  const snapshots = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const row = (await db.execute({sql: 'SELECT snapshot_json FROM hub_item_approvals WHERE item_id=? AND version=?', args: [item.id, item.version]})).rows[0];
    if (!row?.snapshot_json) return {published: 0, duplicates: 0, failed: 0, skipped: true, reason: 'approval_missing', target: 'none'};
    snapshots.set(item.id, JSON.parse(String(row.snapshot_json)));
  }
  const claimed: string[] = [];
  for (const item of items) {
    const key = createHash('sha256').update(`scheduled:${item.id}:${item.version}`).digest('hex');
    const ins = await db.execute({sql: "INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at) VALUES(?,?,?,?,?,'sending',?) ON CONFLICT(idempotency_key) DO NOTHING",
      args: [randomUUID(), key, item.id, item.version, JSON.stringify(snapshots.get(item.id)), new Date(now).toISOString()]});
    if (ins.rowsAffected) claimed.push(item.id);
  }
  let result: DeliveryResult;
  try { result = await deliver(items.filter(i => claimed.includes(i.id)).map(i => ({id: i.id, version: i.version, snapshot: snapshots.get(i.id)!}))); }
  catch (e) {
    const code = (e instanceof Error ? e.message : '').replace(/[^A-Z0-9_]/g, '').slice(0, 60) || 'PUBLISH_DELIVERY_FAILED';
    for (const id of claimed) await db.execute({sql: "UPDATE hub_publish_outbox SET status='failed' WHERE item_id=? AND status='sending'", args: [id]}).catch(() => {});
    await db.execute({sql: 'INSERT INTO hub_publish_runs_v2(id,mode,plan_hash,eligible,excluded,reasons_json,actor,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
      args: [randomUUID(), 'scheduled', plan.planHash, 0, items.length, JSON.stringify({delivery_error: 1}), actor.slice(0, 100), new Date(now).toISOString(), now + 60000]});
    return {published: 0, duplicates: 0, failed: claimed.length, skipped: false, reason: code, target: 'none'};
  }
  for (const id of result.published) await db.execute({sql: "UPDATE hub_publish_outbox SET status='published' WHERE item_id=? AND status='sending'", args: [id]});
  for (const id of result.duplicates) await db.execute({sql: "UPDATE hub_publish_outbox SET status='duplicate' WHERE item_id=? AND status='sending'", args: [id]});
  for (const f of result.failed) await db.execute({sql: "UPDATE hub_publish_outbox SET status='failed' WHERE item_id=? AND status='sending'", args: [f.id]});
  await db.execute({sql: 'INSERT INTO hub_publish_runs_v2(id,mode,plan_hash,eligible,excluded,reasons_json,actor,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
    args: [randomUUID(), 'scheduled', plan.planHash, result.published.length, plan.excluded, JSON.stringify(plan.reasons), actor.slice(0, 100), new Date(now).toISOString(), now + 60000]});
  return {published: result.published.length, duplicates: result.duplicates.length, failed: result.failed.length, skipped: false, reason: null, target: result.target, maxPerRun: items.length};
}

export async function publishStatus(db: Client) {
  if (!(await publishReady(db))) return {ready: false, config: {...DEFAULT_CONFIG}, policy: PUBLISH_POLICY, outbox: {}, runs: [], targetConfigured: targetConfigured(), publicationEnabled: false};
  const config = await readConfig(db);
  const outbox = Object.fromEntries((await db.execute('SELECT status,count(*) n FROM hub_publish_outbox GROUP BY status')).rows.map(r => [String(r.status), Number(r.n)]));
  const runs = (await db.execute('SELECT mode,plan_hash,eligible,excluded,reasons_json,actor,created_at FROM hub_publish_runs_v2 ORDER BY created_at DESC LIMIT 5')).rows.map(r => ({
    mode: String(r.mode), planHash: String(r.plan_hash).slice(0, 12) + '…', eligible: Number(r.eligible), excluded: Number(r.excluded), reasons: parse(r.reasons_json) || {}, actor: String(r.actor), createdAt: String(r.created_at)}));
  return {ready: true, config, policy: PUBLISH_POLICY, outbox, runs, targetConfigured: targetConfigured(), armed: config.enabled && config.mode === 'live' && Number(config.armedUntil || 0) > Date.now(), publicationEnabled: config.enabled && config.mode === 'live'};
}
