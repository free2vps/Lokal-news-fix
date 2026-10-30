import type {Client} from '@libsql/client';
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {articleSlug} from './publish-delivery';

/**
 * Langkah 9a: antrean kiriman ke media sosial (model PULL) untuk Make.com.
 * - Hub menyiapkan antrean dari artikel yang SUDAH terbit di situs (outbox 'published').
 * - Make menarik maksimal 4 berita per putaran; setelah berhasil posting, Make mengirim ack.
 * - Klaim memakai lease: bila Make gagal/berhenti, item kembali ke antrean setelah lease habis.
 * - Semantik: at-least-once. Bila ack gagal padahal posting sukses, item bisa terkirim ulang
 *   setelah lease 6 jam; karena itu cap 4 + jeda 3 jam dibuat konservatif.
 */
export const SOCIAL_POLICY = {
  maxPerPull: 4,
  hardMaxPerPull: 4,
  claimLeaseMs: 6 * 3600000,
  maxAttempts: 5,
  deliverySemantics: 'at_least_once',
  facebookPostedBy: 'make.com',
  notes: [
    'Hub tidak menyimpan token Facebook; posting dilakukan skenario Make.',
    'Hanya artikel yang sudah terbit di situs yang masuk antrean media sosial.',
    'Bila ack tidak terkirim, item dapat muncul lagi setelah lease 6 jam—periksa halaman Facebook dahulu.',
    'Antrean hanya berisi artikel yang sudah disetujui manusia dan terbit; tidak ada publikasi tanpa persetujuan.',
  ],
} as const;

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const clampInt = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d; };
const keyFor = (itemId: string, version: number) => createHash('sha256').update(`social:${itemId}:${version}`).digest('hex').slice(0, 32);

export async function prepareSocialSchema(db: Client) {
  const tx = await db.transaction('write');
  try {
    await tx.execute(`CREATE TABLE IF NOT EXISTS hub_social_tokens_v2(
      id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL DEFAULT 'pull,ack', created_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT)`);
    await tx.execute(`CREATE TABLE IF NOT EXISTS hub_social_queue_v2(
      delivery_key TEXT PRIMARY KEY, item_id TEXT NOT NULL, item_version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','delivered','failed','skipped')),
      attempts INTEGER NOT NULL DEFAULT 0, claimed_until INTEGER NOT NULL DEFAULT 0, claimed_by TEXT,
      last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT,
      UNIQUE(item_id,item_version))`);
    await tx.execute('CREATE INDEX IF NOT EXISTS hub_social_queue_ready ON hub_social_queue_v2(status,claimed_until)');
    await tx.execute(`CREATE TABLE IF NOT EXISTS hub_social_runs_v2(
      id TEXT PRIMARY KEY, action TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0,
      delivered INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      actor TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL)`);
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  return socialStatus(db);
}

export async function socialReady(db: Client) {
  return (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_social_queue_v2'")).rows.length === 1;
}

/** Isi antrean dari outbox yang sudah berstatus published (idempoten). */
export async function enqueuePublished(db: Client, now = Date.now()) {
  if (!(await socialReady(db))) throw Error('SOCIAL_NOT_READY');
  const rows = (await db.execute({sql: "SELECT o.item_id,o.approved_version FROM hub_publish_outbox o WHERE o.status='published' ORDER BY o.created_at,o.item_id", args: []})).rows;
  let inserted = 0;
  for (const r of rows) {
    const res = await db.execute({sql: `INSERT OR IGNORE INTO hub_social_queue_v2(delivery_key,item_id,item_version,status,created_at,updated_at)
      VALUES(?,?,?,'pending',?,?)`, args: [keyFor(String(r.item_id), Number(r.approved_version)), String(r.item_id), Number(r.approved_version), new Date(now).toISOString(), new Date(now).toISOString()]});
    inserted += res.rowsAffected;
  }
  return {examined: rows.length, inserted};
}

export type SocialItem = {
  deliveryKey: string; itemId: string; version: number; title: string; summary: string;
  sourceName: string; sourceUrl: string; articleUrl: string; articleUrlSource: 'site' | 'original';
  publishedAt: string | null; category: string | null; region: string | null; attempts: number;
};

export function siteBase(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.HUB_PUBLIC_SITE_URL || '';
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password ? u.origin : null; } catch { return null; }
}

async function itemPayload(db: Client, itemId: string, version: number, deliveryKey: string, attempts: number, env: NodeJS.ProcessEnv): Promise<SocialItem | null> {
  const row = (await db.execute({sql: `SELECT i.editorial_title,i.source_title,i.editorial_summary,i.source_snippet,i.original_url,i.editorial_category,i.source_published_at,
      s.name source_name,s.region,o.snapshot_json
    FROM hub_items i JOIN hub_sources s ON s.id=i.source_id
    LEFT JOIN hub_publish_outbox o ON o.item_id=i.id AND o.approved_version=? AND o.status='published'
    WHERE i.id=?`, args: [version, itemId]})).rows[0];
  if (!row) return null;
  const title = String(row.editorial_title || row.source_title || '').trim();
  const summary = String(row.editorial_summary || row.source_snippet || '').trim().slice(0, 400);
  if (!title) return null;
  let articleUrl = String(row.original_url);
  let articleUrlSource: 'site' | 'original' = 'original';
  const base = siteBase(env);
  if (base) {
    let slug: string | null = null;
    try { const snap = row.snapshot_json ? JSON.parse(String(row.snapshot_json)) : null; slug = snap ? articleSlug(snap) : null; } catch { slug = null; }
    if (slug) { articleUrl = `${base}/berita/${slug}`; articleUrlSource = 'site'; }
  }
  return {
    deliveryKey, itemId, version, title, summary, sourceName: String(row.source_name || ''),
    sourceUrl: String(row.original_url), articleUrl, articleUrlSource,
    publishedAt: row.source_published_at ? String(row.source_published_at) : null,
    category: row.editorial_category ? String(row.editorial_category) : null,
    region: row.region ? String(row.region) : null, attempts,
  };
}

/** Klaim hingga 4 item; lease 6 jam agar aman bila skenario Make berhenti di tengah. */
export async function claimBatch(db: Client, opts: {max?: number; label?: string; now?: number; env?: NodeJS.ProcessEnv} = {}) {
  if (!(await socialReady(db))) throw Error('SOCIAL_NOT_READY');
  const now = opts.now ?? Date.now();
  const max = clampInt(opts.max, 1, SOCIAL_POLICY.hardMaxPerPull, SOCIAL_POLICY.maxPerPull);
  const label = String(opts.label || 'make').slice(0, 60);
  await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='pending',claimed_by=NULL,claimed_until=0,updated_at=? WHERE status='claimed' AND claimed_until<? AND attempts<?", args: [new Date(now).toISOString(), now, SOCIAL_POLICY.maxAttempts]});
  await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='failed',claimed_by=NULL,claimed_until=0,last_error='CLAIM_EXPIRED',updated_at=? WHERE status='claimed' AND claimed_until<? AND attempts>=?", args: [new Date(now).toISOString(), now, SOCIAL_POLICY.maxAttempts]});
  const ready = (await db.execute({sql: "SELECT delivery_key,item_id,item_version,attempts FROM hub_social_queue_v2 WHERE status='pending' ORDER BY created_at,delivery_key LIMIT ?", args: [max]})).rows;
  const claimed: SocialItem[] = [];
  for (const r of ready) {
    const upd = await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='claimed',claimed_by=?,claimed_until=?,attempts=attempts+1,updated_at=? WHERE delivery_key=? AND status='pending'",
      args: [label, now + SOCIAL_POLICY.claimLeaseMs, new Date(now).toISOString(), String(r.delivery_key)]});
    if (!upd.rowsAffected) continue;
    const payload = await itemPayload(db, String(r.item_id), Number(r.item_version), String(r.delivery_key), Number(r.attempts) + 1, opts.env || process.env);
    if (payload) claimed.push(payload);
    else await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='skipped',last_error='ITEM_PAYLOAD_EMPTY',updated_at=? WHERE delivery_key=?", args: [new Date(now).toISOString(), String(r.delivery_key)]});
  }
  await db.execute({sql: 'INSERT INTO hub_social_runs_v2(id,action,claimed,actor,created_at) VALUES(?,?,?,?,?)', args: [randomUUID(), 'pull', claimed.length, label, new Date(now).toISOString()]});
  return {
    count: claimed.length, limit: max,
    remaining: Number((await db.execute({sql: "SELECT count(*) n FROM hub_social_queue_v2 WHERE status='pending'", args: []})).rows[0].n),
    items: claimed, deliverySemantics: SOCIAL_POLICY.deliverySemantics, leaseMinutes: SOCIAL_POLICY.claimLeaseMs / 60000,
  };
}

/** Ack dari Make setelah posting; tanpa ack, item kembali ke antrean setelah lease habis. */
export async function acknowledge(db: Client, results: unknown, label = 'make', now = Date.now()) {
  if (!(await socialReady(db))) throw Error('SOCIAL_NOT_READY');
  if (!Array.isArray(results) || results.length > 10) throw Error('SOCIAL_ACK_INVALID');
  let delivered = 0, failed = 0, ignored = 0;
  for (const raw of results) {
    const r = raw as {deliveryKey?: unknown; ok?: unknown; error?: unknown};
    if (typeof r?.deliveryKey !== 'string' || !/^[a-f0-9]{32}$/.test(r.deliveryKey)) throw Error('SOCIAL_ACK_INVALID');
    const ok = r.ok === true;
    const stamp = new Date(now).toISOString();
    const upd = await db.execute({sql: ok
      ? "UPDATE hub_social_queue_v2 SET status='delivered',claimed_until=0,last_error=NULL,delivered_at=?,updated_at=? WHERE delivery_key=? AND status IN ('claimed','pending')"
      : "UPDATE hub_social_queue_v2 SET status='failed',claimed_until=0,last_error=?,updated_at=? WHERE delivery_key=? AND status IN ('claimed','pending')",
      args: ok ? [stamp, stamp, r.deliveryKey] : [String(r.error || 'MAKE_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 40), stamp, r.deliveryKey]});
    if (!upd.rowsAffected) ignored += 1; else if (ok) delivered += 1; else failed += 1;
  }
  await db.execute({sql: 'INSERT INTO hub_social_runs_v2(id,action,claimed,delivered,failed,actor,created_at) VALUES(?,?,?,?,?,?,?)', args: [randomUUID(), 'ack', results.length, delivered, failed, label.slice(0, 60), new Date(now).toISOString()]});
  return {delivered, failed, ignored};
}

export async function socialStatus(db: Client) {
  if (!(await socialReady(db))) return {ready: false, queue: {}, tokens: [], runs: [], policy: SOCIAL_POLICY, siteUrlConfigured: Boolean(siteBase()), facebookMaxPerRun: SOCIAL_POLICY.maxPerPull, pending: 0, delivered: 0, failed: 0};
  const queue = Object.fromEntries((await db.execute('SELECT status,count(*) n FROM hub_social_queue_v2 GROUP BY status')).rows.map(r => [String(r.status), Number(r.n)]));
  const tokens = (await db.execute('SELECT id,label,scopes,created_at,revoked_at,last_used_at FROM hub_social_tokens_v2 ORDER BY created_at DESC')).rows.map(r => ({id: String(r.id), label: String(r.label), scopes: String(r.scopes), createdAt: String(r.created_at), revoked: Boolean(r.revoked_at), lastUsedAt: r.last_used_at ? String(r.last_used_at) : null}));
  const runs = (await db.execute('SELECT action,claimed,delivered,failed,actor,created_at FROM hub_social_runs_v2 ORDER BY created_at DESC LIMIT 10')).rows.map(r => ({action: String(r.action), claimed: Number(r.claimed), delivered: Number(r.delivered), failed: Number(r.failed), actor: String(r.actor), at: String(r.created_at)}));
  return {ready: true, queue, tokens, runs, policy: SOCIAL_POLICY, siteUrlConfigured: Boolean(siteBase()), facebookMaxPerRun: SOCIAL_POLICY.maxPerPull, pending: queue.pending || 0, delivered: queue.delivered || 0, failed: queue.failed || 0};
}

export async function issueSocialToken(db: Client, label: unknown, now = Date.now()) {
  if (!(await socialReady(db))) throw Error('SOCIAL_NOT_READY');
  const clean = typeof label === 'string' && label.trim().length >= 2 && label.trim().length <= 60 ? label.trim() : 'make.com';
  const token = randomBytes(32).toString('hex');
  await db.execute({sql: "INSERT INTO hub_social_tokens_v2(id,label,token_hash,scopes,created_at) VALUES(?,?,?,'pull,ack',?)", args: [randomUUID(), clean, hashToken(token), new Date(now).toISOString()]});
  return {token, label: clean, scopes: ['pull', 'ack'], note: 'Simpan sekarang; token hanya untuk /api/hub/social (pull & ack). Jangan taruh di frontend/GitHub.'};
}

export async function revokeSocialToken(db: Client, id: unknown, now = Date.now()) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw Error('SOCIAL_TOKEN_INVALID');
  const r = await db.execute({sql: 'UPDATE hub_social_tokens_v2 SET revoked_at=? WHERE id=? AND revoked_at IS NULL', args: [new Date(now).toISOString(), id]});
  if (!r.rowsAffected) throw Error('SOCIAL_TOKEN_INVALID');
  return {revoked: true};
}

export async function verifySocialToken(db: Client, header: string | null, now = Date.now()) {
  if (!header || !/^Bearer [0-9a-f]{64}$/.test(header)) return false;
  if (!(await socialReady(db))) return false;
  const presented = Buffer.from(hashToken(header.slice(7)), 'hex');
  for (const r of (await db.execute({sql: 'SELECT id,token_hash FROM hub_social_tokens_v2 WHERE revoked_at IS NULL', args: []})).rows) {
    const stored = Buffer.from(String(r.token_hash), 'hex');
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) {
      await db.execute({sql: 'UPDATE hub_social_tokens_v2 SET last_used_at=? WHERE id=?', args: [new Date(now).toISOString(), String(r.id)]}).catch(() => {});
      return true;
    }
  }
  return false;
}

/** Kembalikan item failed ke pending (manual, mis. setelah salah konfigurasi). */
export async function requeueFailed(db: Client, now = Date.now()) {
  const r = await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='pending',attempts=0,last_error=NULL,claimed_until=0,updated_at=? WHERE status='failed'", args: [new Date(now).toISOString()]});
  return {requeued: r.rowsAffected};
}
