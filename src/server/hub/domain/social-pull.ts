import type {Client} from '@libsql/client';
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {articleSlug} from './publish-delivery';
import {largeImage} from '../../../lib/image-variant';

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
  /** Dikurangi dari 5 → 2: satu kali coba ulang saja. Kiriman ganda lebih merugikan daripada
   *  satu berita yang tidak terkirim. */
  maxAttempts: 2,
  /** Berita lebih tua dari ini TIDAK diposting; ditandai basi agar antrean tidak menumpuk. */
  maxAgeHours: 6,
  /** Batas kiriman per 24 jam — penjaga biaya Make dan penjaga agar halaman FB tidak dibanjiri. */
  dailyPostCap: 16,
  pullOrder: 'newest_first',
  /** Baris lama (terkirim/basi) disimpan 14 hari untuk riwayat, lalu dibuang agar tabel tidak menggelembung. */
  retentionDays: 14,
  deliverySemantics: 'at_least_once',
  facebookPostedBy: 'make.com',
  notes: [
    'Hub tidak menyimpan token Facebook; posting dilakukan skenario Make.',
    'Hanya artikel yang sudah terbit di situs yang masuk antrean media sosial.',
    'Bila ack tidak terkirim, item dapat muncul lagi setelah lease 6 jam—periksa halaman Facebook dahulu.',
    'Antrean hanya berisi artikel yang sudah disetujui manusia dan terbit; tidak ada publikasi tanpa persetujuan.',
    'Yang diambil SELALU berita terbaru. Berita yang lewat 6 jam ditandai basi (STALE_UNPOSTED) dan tidak diposting.',
    'Karena itu antrean tidak tumbuh tanpa batas dan yang tampil di media sosial selalu berita segar.',
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
    // PENJAGA KIRIMAN GANDA (gejala 12 Nov 2026: satu berita terposting 4× di Facebook).
    // delivery_key memuat item_version, jadi begitu artikel disunting lalu disetujui ulang,
    // versinya berubah → kunci baru → terposting LAGI. Indeks unik parsial ini membuat
    // satu artikel mustahil punya dua baris 'delivered'. Dibuat dalam try/catch: bila basis
    // data lama sudah telanjur berisi ganda, index tidak dibuat, tetapi penjaga di kode
    // (enqueuePublished & claimBatch) tetap bekerja.
    try { await tx.execute("CREATE UNIQUE INDEX IF NOT EXISTS hub_social_one_delivery ON hub_social_queue_v2(item_id) WHERE status='delivered'"); } catch { /* data lama berisi ganda */ }
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
  // Sebelum mengambil, buang baris pending yang artikelnya sudah pernah terkirim.
  // Ini lapis kedua: menjaga walau indeks unik tidak sempat dibuat pada data lama.
  await db.execute({sql: `UPDATE hub_social_queue_v2 SET status='skipped',last_error='ALREADY_POSTED',updated_at=?
      WHERE status IN ('pending','claimed') AND item_id IN
        (SELECT item_id FROM hub_social_queue_v2 WHERE status='delivered')`,
    args: [new Date(now).toISOString()]});
  const cutoff = new Date(now - SOCIAL_POLICY.maxAgeHours * 3600000).toISOString();
  const rows = (await db.execute({sql: `SELECT o.item_id,o.approved_version FROM hub_publish_outbox o
      JOIN hub_items i ON i.id=o.item_id
      WHERE o.status='published' AND COALESCE(i.source_published_at,o.created_at)>=?
      ORDER BY COALESCE(i.source_published_at,o.created_at) DESC,o.item_id`, args: [cutoff]})).rows;
  // Artikel yang SUDAH pernah terkirim tidak boleh masuk antrean lagi, walau versinya berubah.
  const sudah = new Set(
    (await db.execute({sql: "SELECT DISTINCT item_id FROM hub_social_queue_v2 WHERE status='delivered'", args: []}))
      .rows.map(x => String(x.item_id)),
  );
  let inserted = 0, dilewati = 0;
  for (const r of rows) {
    if (sudah.has(String(r.item_id))) { dilewati += 1; continue; }
    const res = await db.execute({sql: `INSERT OR IGNORE INTO hub_social_queue_v2(delivery_key,item_id,item_version,status,created_at,updated_at)
      VALUES(?,?,?,'pending',?,?)`, args: [keyFor(String(r.item_id), Number(r.approved_version)), String(r.item_id), Number(r.approved_version), new Date(now).toISOString(), new Date(now).toISOString()]});
    inserted += res.rowsAffected;
  }
  return {examined: rows.length, inserted, dilewati};
}

export type SocialItem = {
  deliveryKey: string; itemId: string; version: number; title: string; summary: string;
  sourceName: string; sourceUrl: string; articleUrl: string; articleUrlSource: 'site' | 'original';
  publishedAt: string | null; category: string | null; region: string | null; attempts: number;
  /** Gambar asli penerbit (bukan di-rehost). null bila hak sumber belum dinyatakan. */
  image: string | null;
  /** Umur berita dalam jam saat diambil — Make bisa menolak memposting bila terlalu tua. */
  ageHours: number;
};

/**
 * Alamat portal sendiri, dipakai untuk membentuk tautan yang diposting ke media sosial.
 *
 * Sebelumnya hanya membaca HUB_PUBLIC_SITE_URL. Variabel itu tidak selalu diisi, sehingga
 * siteBase() bernilai null dan tautan yang terkirim jatuh ke URL situs sumber — pembaca
 * keluar dari portal. Sekarang ada urutan cadangan, jadi tidak perlu mengisi variabel baru.
 */
export function siteBase(env: NodeJS.ProcessEnv = process.env) {
  const calon = [
    env.HUB_PUBLIC_SITE_URL,
    env.NEXT_PUBLIC_SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '',
  ];
  for (const raw of calon) {
    const teks = String(raw || '').trim();
    if (!teks) continue;
    try {
      const u = new URL(teks);
      if (u.protocol === 'https:' && !u.username && !u.password) return u.origin;
    } catch { /* lanjut ke cadangan berikutnya */ }
  }
  return null;
}

async function itemPayload(db: Client, itemId: string, version: number, deliveryKey: string, attempts: number, env: NodeJS.ProcessEnv, now = Date.now()): Promise<SocialItem | null> {
  const row = (await db.execute({sql: `SELECT i.editorial_title,i.source_title,i.editorial_summary,i.source_snippet,i.original_url,i.editorial_category,i.source_published_at,i.source_image_url,
      s.name source_name,s.region,s.rights_status,o.snapshot_json
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
    ageHours: row.source_published_at ? Math.max(0, Math.round((now - Date.parse(String(row.source_published_at))) / 3600000)) : 0,
    // Sama seperti halaman artikel: gambar hanya dipakai bila hak sumber sudah dinyatakan.
    // Bila null, Facebook tetap mengambil gambar dari halaman artikel lewat og:image.
    // Varian besar: kalau Make memakai "Create a Post with Photos", gambar 360 px akan
    // tampil buram. Untuk kartu tautan, ukuran og:image di halaman artikel yang menentukan.
    image: String(row.rights_status) === 'permission_confirmed' && /^https:\/\//i.test(String(row.source_image_url || ''))
      ? largeImage(String(row.source_image_url)).url : null,
  };
}

/** Klaim hingga 4 item; lease 6 jam agar aman bila skenario Make berhenti di tengah. */
export async function claimBatch(db: Client, opts: {max?: number; label?: string; now?: number; env?: NodeJS.ProcessEnv; cap?: number} = {}) {
  if (!(await socialReady(db))) throw Error('SOCIAL_NOT_READY');
  const now = opts.now ?? Date.now();
  const max = clampInt(opts.max, 1, SOCIAL_POLICY.hardMaxPerPull, SOCIAL_POLICY.maxPerPull);
  const label = String(opts.label || 'make').slice(0, 60);
  await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='pending',claimed_by=NULL,claimed_until=0,updated_at=? WHERE status='claimed' AND claimed_until<? AND attempts<?", args: [new Date(now).toISOString(), now, SOCIAL_POLICY.maxAttempts]});
  await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='failed',claimed_by=NULL,claimed_until=0,last_error='CLAIM_EXPIRED',updated_at=? WHERE status='claimed' AND claimed_until<? AND attempts>=?", args: [new Date(now).toISOString(), now, SOCIAL_POLICY.maxAttempts]});
  // Sebelum mengambil, buang baris pending yang artikelnya sudah pernah terkirim.
  // Ini lapis kedua: menjaga walau indeks unik tidak sempat dibuat pada data lama.
  await db.execute({sql: `UPDATE hub_social_queue_v2 SET status='skipped',last_error='ALREADY_POSTED',updated_at=?
      WHERE status IN ('pending','claimed') AND item_id IN
        (SELECT item_id FROM hub_social_queue_v2 WHERE status='delivered')`,
    args: [new Date(now).toISOString()]});
  const cutoff = new Date(now - SOCIAL_POLICY.maxAgeHours * 3600000).toISOString();
  // Antrean tidak boleh tumbuh selamanya: yang lewat batas umur dibuang, bukan diposting telat.
  const stale = await db.execute({sql: `UPDATE hub_social_queue_v2 SET status='skipped',claimed_until=0,last_error='STALE_UNPOSTED',updated_at=?
      WHERE status='pending' AND item_id IN (SELECT id FROM hub_items WHERE COALESCE(source_published_at, '1970-01-01')<?)`,
    args: [new Date(now).toISOString(), cutoff]});
  // Kuota 24 jam bergulir.
  const terkirim24 = Number((await db.execute({sql: "SELECT count(*) n FROM hub_social_queue_v2 WHERE status='delivered' AND delivered_at>=?", args: [new Date(now - 24 * 3600000).toISOString()]})).rows[0].n);
  const kuotaHarian = clampInt(opts.cap, 1, 48, SOCIAL_POLICY.dailyPostCap);
  const sisaKuota = Math.max(0, kuotaHarian - terkirim24);
  const ambil = Math.min(max, sisaKuota);
  const ready = ambil > 0
    ? (await db.execute({sql: `SELECT q.delivery_key,q.item_id,q.item_version,q.attempts
          FROM hub_social_queue_v2 q JOIN hub_items i ON i.id=q.item_id
          WHERE q.status='pending' AND COALESCE(i.source_published_at,q.created_at)>=?
          ORDER BY COALESCE(i.source_published_at,q.created_at) DESC,q.delivery_key LIMIT ?`, args: [cutoff, ambil]})).rows
    : [];
  const claimed: SocialItem[] = [];
  for (const r of ready) {
    const upd = await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='claimed',claimed_by=?,claimed_until=?,attempts=attempts+1,updated_at=? WHERE delivery_key=? AND status='pending'",
      args: [label, now + SOCIAL_POLICY.claimLeaseMs, new Date(now).toISOString(), String(r.delivery_key)]});
    if (!upd.rowsAffected) continue;
    const payload = await itemPayload(db, String(r.item_id), Number(r.item_version), String(r.delivery_key), Number(r.attempts) + 1, opts.env || process.env, now);
    if (payload) claimed.push(payload);
    else await db.execute({sql: "UPDATE hub_social_queue_v2 SET status='skipped',last_error='ITEM_PAYLOAD_EMPTY',updated_at=? WHERE delivery_key=?", args: [new Date(now).toISOString(), String(r.delivery_key)]});
  }
  await db.execute({sql: 'INSERT INTO hub_social_runs_v2(id,action,claimed,actor,created_at) VALUES(?,?,?,?,?)', args: [randomUUID(), 'pull', claimed.length, label, new Date(now).toISOString()]});
  await db.execute({sql: "DELETE FROM hub_social_queue_v2 WHERE status IN ('delivered','skipped','failed') AND updated_at<?", args: [new Date(now - SOCIAL_POLICY.retentionDays * 86400000).toISOString()]});
  const sisaAntrean = Number((await db.execute({sql: "SELECT count(*) n FROM hub_social_queue_v2 WHERE status='pending'", args: []})).rows[0].n);
  return {
    count: claimed.length, limit: ambil,
    reason: claimed.length === 0
      ? (sisaKuota === 0 ? 'DAILY_CAP_REACHED' : (sisaAntrean === 0 ? 'QUEUE_EMPTY' : 'NO_FRESH_ITEMS'))
      : null,
    expiredNow: Number(stale.rowsAffected || 0),
    deliveredLast24h: terkirim24, dailyPostCap: kuotaHarian, maxAgeHours: SOCIAL_POLICY.maxAgeHours,
    remaining: sisaAntrean,
    // 'site' = tautan ke portal sendiri (yang diinginkan). 'original' = jatuh ke situs sumber,
    // terjadi bila alamat portal tidak dapat ditentukan sama sekali.
    linkTarget: siteBase(opts.env || process.env) ? 'site' : 'original',
    siteUrl: siteBase(opts.env || process.env),
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
  const tertua = (await db.execute("SELECT min(created_at) t FROM hub_social_queue_v2 WHERE status='pending'")).rows[0];
  const terkirim24 = Number((await db.execute({sql: "SELECT count(*) n FROM hub_social_queue_v2 WHERE status='delivered' AND delivered_at>=?", args: [new Date(Date.now() - 24 * 3600000).toISOString()]})).rows[0].n);
  // healthy = tidak ada tumpukan basi yang menunggu terlalu lama
  const umurTertua = tertua?.t ? Math.round((Date.now() - Date.parse(String(tertua.t))) / 3600000) : 0;
  return {ready: true, queue, tokens, runs, policy: SOCIAL_POLICY, siteUrlConfigured: Boolean(siteBase()), facebookMaxPerRun: SOCIAL_POLICY.maxPerPull, pending: queue.pending || 0, delivered: queue.delivered || 0, failed: queue.failed || 0,
    stale: queue.skipped || 0, oldestPendingHours: umurTertua, deliveredLast24h: terkirim24,
    backlogHealthy: umurTertua <= SOCIAL_POLICY.maxAgeHours};
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
