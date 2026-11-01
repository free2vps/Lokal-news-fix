import type {Client} from '@libsql/client';
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {profileBatch} from './content-profile';
import {valueBatch} from './editorial-value';
import {runSummaryBatch, summaryStatus} from './ai-summary';
import {getPreferences} from './operations';

/**
 * Langkah 7: pekerja tahan-putus (durable worker).
 * - Antrean tersimpan di database: lease, retry berjenjang, dead letter, log.
 * - Satu runner aktif; setiap tick dibatasi waktu dan jumlah tugas.
 * - Tidak pernah menerbitkan atau mengubah berita; hanya tugas analisis yang sudah ada.
 * - Penjadwal otomatis TIDAK diaktifkan di sini (cron Vercel adalah perubahan Production terpisah).
 */
export const WORKER_VERSION = 'worker_v1';
export const TASK_KINDS = ['profiles_batch', 'value_batch', 'summary_batch'] as const;
const TASK_PREREQUISITE: Record<string, string> = {profiles_batch: 'hub_content_profiles_v2', value_batch: 'hub_editorial_value_v2', summary_batch: 'hub_ai_summaries_v2'};
export type TaskKind = (typeof TASK_KINDS)[number];

export const WORKER_POLICY = {
  leaseMs: 45000,
  taskLeaseMs: 120000,
  maxAttempts: 3,
  backoffMs: [60000, 180000, 600000],
  tickMaxTasks: 3,
  tickBudgetMs: 22000,
  maxQueuedPerKind: 50,
  schedulerMode: 'manual_or_external',
  cronConfigured: false,
  publicationEnabled: false,
  notes: [
    'Penjadwal otomatis tidak aktif: hub ini tidak mengubah cron Production. Picu manual atau lewat penjadwal eksternal dengan token pekerja.',
    'Setiap tick memproses tugas berurutan dengan batas waktu; tugas yang macet dikembalikan ke antrean setelah lease kedaluwarsa.',
    'Tugas ringkasan tetap tunduk pada kuota gratis harian dan izin provider yang sudah ada.',
    'Pekerja tidak menerbitkan, tidak menyetujui, dan tidak mengubah isi/editan berita.',
  ],
} as const;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : dflt; };

export async function prepareWorkerSchema(db: Client) {
  const tx = await db.transaction('write');
  try {
    await tx.execute(`CREATE TABLE IF NOT EXISTS hub_worker_tasks_v2(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued','leased','done','failed','dead')),
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at INTEGER NOT NULL, lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT)`);
    await tx.execute('CREATE INDEX IF NOT EXISTS hub_worker_tasks_ready ON hub_worker_tasks_v2(status,next_run_at)');
    await tx.execute('CREATE TABLE IF NOT EXISTS hub_worker_state_v2(id TEXT PRIMARY KEY,lease_owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,heartbeat_at TEXT)');
    await tx.execute("INSERT OR IGNORE INTO hub_worker_state_v2(id,lease_until) VALUES('runner',0)");
    await tx.execute(`CREATE TABLE IF NOT EXISTS hub_worker_logs_v2(id TEXT PRIMARY KEY,task_id TEXT,kind TEXT,status TEXT NOT NULL,message TEXT NOT NULL,at TEXT NOT NULL)`);
    await tx.execute('CREATE TABLE IF NOT EXISTS hub_worker_tokens_v2(id TEXT PRIMARY KEY,label TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,revoked_at TEXT,last_used_at TEXT)');
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  return workerStatus(db);
}

export async function workerReady(db: Client) {
  return (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_worker_tasks_v2'")).rows.length === 1;
}

export async function enqueueTask(db: Client, input: {kind: unknown; payload?: unknown; idempotencyKey?: unknown; maxAttempts?: unknown}, now = Date.now()) {
  const kind = String(input.kind || '') as TaskKind;
  if (!TASK_KINDS.includes(kind)) throw Error('WORKER_KIND_INVALID');
  if (!(await workerReady(db))) throw Error('WORKER_NOT_READY');
  const payload = input.payload && typeof input.payload === 'object' ? input.payload as Record<string, unknown> : {};
  if (Object.keys(payload).some(k => !['cursor', 'id', 'maxItems'].includes(k))) throw Error('WORKER_PAYLOAD_INVALID');
  const queued = Number((await db.execute({sql: 'SELECT count(*) n FROM hub_worker_tasks_v2 WHERE kind=? AND status IN (\'queued\',\'leased\',\'failed\')', args: [kind]})).rows[0].n);
  if (queued >= WORKER_POLICY.maxQueuedPerKind) throw Error('WORKER_QUEUE_FULL');
  const prerequisite = TASK_PREREQUISITE[kind];
  if (prerequisite && (await db.execute({sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", args: [prerequisite]})).rows.length !== 1) throw Error('WORKER_PREREQUISITE');
  const key = typeof input.idempotencyKey === 'string' && /^[\w:.-]{8,120}$/.test(input.idempotencyKey) ? input.idempotencyKey : `${kind}:${now}:${randomBytes(4).toString('hex')}`;
  const existing = (await db.execute({sql: 'SELECT id,status FROM hub_worker_tasks_v2 WHERE idempotency_key=?', args: [key]})).rows[0];
  if (existing) return {id: String(existing.id), status: String(existing.status), deduplicated: true};
  const id = randomUUID(), stamp = new Date(now).toISOString();
  await db.execute({sql: `INSERT INTO hub_worker_tasks_v2(id,kind,payload_json,idempotency_key,status,attempts,max_attempts,next_run_at,lease_until,created_at,updated_at)
    VALUES(?,?,?,?,'queued',0,?,?,0,?,?)`, args: [id, kind, JSON.stringify(payload), key, clampInt(input.maxAttempts, 1, 5, WORKER_POLICY.maxAttempts), now, stamp, stamp]});
  await log(db, id, kind, 'QUEUED', 'Tugas masuk antrean', now);
  return {id, status: 'queued', deduplicated: false};
}

async function log(db: Client, taskId: string | null, kind: string, status: string, message: string, now = Date.now()) {
  await db.execute({sql: 'INSERT INTO hub_worker_logs_v2(id,task_id,kind,status,message,at) VALUES(?,?,?,?,?,?)', args: [randomUUID(), taskId, kind, status, message.slice(0, 300), new Date(now).toISOString()]}).catch(() => {});
}

/** Kembalikan tugas yang lease-nya kedaluwarsa ke antrean; tidak menghapus riwayat. */
export async function recoverExpiredTasks(db: Client, now = Date.now()) {
  if (!(await workerReady(db))) return {recovered: 0};
  const rows = (await db.execute({sql: "SELECT id,kind,attempts,max_attempts FROM hub_worker_tasks_v2 WHERE status='leased' AND lease_until<?", args: [now]})).rows;
  for (const r of rows) {
    const dead = Number(r.attempts) >= Number(r.max_attempts);
    await db.execute({sql: "UPDATE hub_worker_tasks_v2 SET status=?,lease_owner=NULL,lease_until=0,next_run_at=?,updated_at=?,last_error=? WHERE id=? AND status='leased'", args: [dead ? 'dead' : 'queued', now, new Date(now).toISOString(), 'LEASE_EXPIRED', String(r.id)]});
    await log(db, String(r.id), String(r.kind), dead ? 'DEAD' : 'RETRY', 'Lease kedaluwarsa', now);
  }
  await db.execute({sql: "UPDATE hub_worker_state_v2 SET lease_until=0 WHERE id='runner' AND lease_until<?", args: [now]});
  return {recovered: rows.length};
}

async function claim(db: Client, workerId: string, now: number): Promise<{task: any; reason: string}> {
  const leaseUntil = now + WORKER_POLICY.leaseMs;
  const tx = await db.transaction('write');
  try {
    await tx.execute("INSERT OR IGNORE INTO hub_worker_state_v2(id,lease_until) VALUES('runner',0)");
    const runner = await tx.execute({sql: "UPDATE hub_worker_state_v2 SET lease_owner=?,lease_until=?,heartbeat_at=? WHERE id='runner' AND lease_until<?", args: [workerId, leaseUntil, new Date(now).toISOString(), now]});
    if (!runner.rowsAffected) { await tx.commit(); return {task: null, reason: 'runner_busy' as const}; }
    const next = (await tx.execute({sql: "SELECT * FROM hub_worker_tasks_v2 WHERE status IN ('queued','failed') AND next_run_at<=? ORDER BY next_run_at,created_at LIMIT 1", args: [now]})).rows[0];
    if (!next) { await tx.execute({sql: "UPDATE hub_worker_state_v2 SET lease_until=0,lease_owner=NULL WHERE id='runner' AND lease_owner=?", args: [workerId]}); await tx.commit(); return {task: null, reason: 'empty' as const}; }
    const claimed = await tx.execute({sql: "UPDATE hub_worker_tasks_v2 SET status='leased',lease_owner=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('queued','failed')", args: [workerId, now + WORKER_POLICY.taskLeaseMs, new Date(now).toISOString(), String(next.id)]});
    if (!claimed.rowsAffected) { await tx.execute({sql: "UPDATE hub_worker_state_v2 SET lease_until=0,lease_owner=NULL WHERE id='runner' AND lease_owner=?", args: [workerId]}); await tx.commit(); return {task: null, reason: 'race' as const}; }
    await tx.commit();
    return {task: {...next, attempts: Number(next.attempts) + 1, lease_owner: workerId} as any, reason: 'claimed'};
  } catch (e) { await tx.rollback(); throw e; }
}

async function releaseRunner(db: Client, workerId: string) {
  await db.execute({sql: "UPDATE hub_worker_state_v2 SET lease_until=0,lease_owner=NULL WHERE id='runner' AND lease_owner=?", args: [workerId]}).catch(() => {});
}

async function runTask(db: Client, task: any, now: number) {
  const payload = JSON.parse(String(task.payload_json || '{}')) as {cursor?: string; id?: string; maxItems?: number};
  if (task.kind === 'profiles_batch') return {count: (await profileBatch(db, typeof payload.cursor === 'string' ? payload.cursor : '', typeof payload.id === 'string' ? payload.id : undefined)).processed};
  if (task.kind === 'value_batch') return {count: (await valueBatch(db, typeof payload.cursor === 'string' ? payload.cursor : '', typeof payload.id === 'string' ? payload.id : undefined)).processed};
  if (task.kind === 'summary_batch') {
    const hours = (await getPreferences(db)).freshnessHours;
    const r = await runSummaryBatch(db, {maxItems: clampInt(payload.maxItems, 1, 5, 3), freshnessHours: hours, master: process.env.HUB_MASTER_KEY, now});
    if (r.stopped === 'quota_or_provider' && r.written === 0) throw Error('WORKER_QUOTA_OR_PROVIDER');
    return {count: r.written};
  }
  throw Error('WORKER_KIND_INVALID');
}

export async function tick(db: Client, opts: {workerId?: string; maxTasks?: number; now?: number} = {}) {
  if (!(await workerReady(db))) throw Error('WORKER_NOT_READY');
  const now = opts.now ?? Date.now();
  const workerId = (opts.workerId || 'worker-' + randomBytes(4).toString('hex')).slice(0, 64);
  const maxTasks = clampInt(opts.maxTasks, 1, WORKER_POLICY.tickMaxTasks, 1);
  const deadline = Date.now() + WORKER_POLICY.tickBudgetMs;
  const results: any[] = [];
  const recovered = await recoverExpiredTasks(db, now);
  for (let i = 0; i < maxTasks; i++) {
    if (Date.now() > deadline) break;
    const claimNow = opts.now ? now : Date.now();
    const {task, reason} = await claim(db, workerId, claimNow);
    if (!task) { results.push({claimed: false, reason}); break; }
    const startedAt = Date.now();
    try {
      const out = await runTask(db, task, claimNow);
      await db.execute({sql: "UPDATE hub_worker_tasks_v2 SET status='done',lease_owner=NULL,lease_until=0,last_error=NULL,finished_at=?,updated_at=? WHERE id=?", args: [new Date().toISOString(), new Date().toISOString(), String(task.id)]});
      await log(db, String(task.id), String(task.kind), 'DONE', `Selesai: ${out.count} item`, claimNow);
      results.push({claimed: true, id: String(task.id), kind: String(task.kind), status: 'done', count: out.count, ms: Date.now() - startedAt});
    } catch (e) {
      const code = (e instanceof Error ? e.message : '').replace(/[^A-Z0-9_]/g, '').slice(0, 60) || 'WORKER_FAILED';
      const attempts = Number(task.attempts);
      const maxAttempts = Number(task.max_attempts);
      const dead = attempts >= maxAttempts;
      const backoff = WORKER_POLICY.backoffMs[Math.min(attempts - 1, WORKER_POLICY.backoffMs.length - 1)];
      await db.execute({sql: 'UPDATE hub_worker_tasks_v2 SET status=?,lease_owner=NULL,lease_until=0,last_error=?,next_run_at=?,updated_at=? WHERE id=?', args: [dead ? 'dead' : 'failed', code, claimNow + backoff, new Date(claimNow).toISOString(), String(task.id)]});
      await log(db, String(task.id), String(task.kind), dead ? 'DEAD' : 'RETRY', `${code} (percobaan ${attempts}/${maxAttempts})`, claimNow);
      results.push({claimed: true, id: String(task.id), kind: String(task.kind), status: dead ? 'dead' : 'failed', error: code, attempts, nextRunAt: dead ? null : claimNow + backoff});
    } finally { await releaseRunner(db, workerId); }
  }
  await releaseRunner(db, workerId);
  return {workerId, maxTasks, results, recovered: recovered.recovered, publicationEnabled: false, scheduler: WORKER_POLICY.schedulerMode};
}

export async function workerStatus(db: Client) {
  if (!(await workerReady(db))) return {ready: false, counts: {} as Record<string, number>, queued: 0, dead: 0, next: null, deadLetters: [], logs: [], runner: {active: false, owner: null}, tokens: [], aiQuota: null, policy: WORKER_POLICY, scheduler: WORKER_POLICY.schedulerMode, cronConfigured: false, publicationEnabled: false};
  const counts = (await db.execute('SELECT status,count(*) n FROM hub_worker_tasks_v2 GROUP BY status')).rows;
  const byStatus: Record<string, number> = Object.fromEntries(counts.map(r => [String(r.status), Number(r.n)]));
  const next = (await db.execute({sql: "SELECT kind,next_run_at,attempts,last_error FROM hub_worker_tasks_v2 WHERE status IN ('queued','failed') ORDER BY next_run_at LIMIT 1", args: []})).rows[0];
  const dead = (await db.execute({sql: "SELECT id,kind,attempts,last_error,updated_at FROM hub_worker_tasks_v2 WHERE status='dead' ORDER BY updated_at DESC LIMIT 10", args: []})).rows;
  const logs = (await db.execute('SELECT kind,status,message,at FROM hub_worker_logs_v2 ORDER BY at DESC LIMIT 15')).rows;
  const runner = (await db.execute("SELECT lease_owner,lease_until,heartbeat_at FROM hub_worker_state_v2 WHERE id='runner'")).rows[0];
  const tokens = (await db.execute('SELECT id,label,created_at,revoked_at,last_used_at FROM hub_worker_tokens_v2 ORDER BY created_at DESC')).rows.map(r => ({id: String(r.id), label: String(r.label), createdAt: String(r.created_at), revoked: Boolean(r.revoked_at), lastUsedAt: r.last_used_at ? String(r.last_used_at) : null}));
  let aiQuota: any = null;
  try { const s = await summaryStatus(db); aiQuota = s.quota || null; } catch {}
  return {
    ready: true, counts: byStatus, queued: (byStatus.queued || 0) + (byStatus.failed || 0), dead: byStatus.dead || 0,
    next: next ? {kind: String(next.kind), nextRunAt: Number(next.next_run_at), attempts: Number(next.attempts), lastError: next.last_error ? String(next.last_error) : null} : null,
    deadLetters: dead.map(r => ({id: String(r.id), kind: String(r.kind), attempts: Number(r.attempts), error: r.last_error ? String(r.last_error) : null, at: String(r.updated_at)})),
    logs: logs.map(r => ({kind: String(r.kind), status: String(r.status), message: String(r.message), at: String(r.at)})),
    runner: {active: Boolean(runner && Number(runner.lease_until) > Date.now()), owner: runner?.lease_owner ? String(runner.lease_owner).slice(0, 8) + '…' : null},
    tokens, aiQuota, policy: WORKER_POLICY, scheduler: WORKER_POLICY.schedulerMode, cronConfigured: false, publicationEnabled: false,
  };
}

export async function issueWorkerToken(db: Client, label: unknown, now = Date.now()) {
  if (!(await workerReady(db))) throw Error('WORKER_NOT_READY');
  const clean = typeof label === 'string' && label.trim().length >= 2 && label.trim().length <= 60 ? label.trim() : 'penjadwal eksternal';
  const token = randomBytes(32).toString('hex');
  await db.execute({sql: 'INSERT INTO hub_worker_tokens_v2(id,label,token_hash,created_at) VALUES(?,?,?,?)', args: [randomUUID(), clean, hashToken(token), new Date(now).toISOString()]});
  await log(db, null, 'token', 'ISSUED', `Token pekerja dibuat: ${clean}`, now);
  return {token, label: clean, note: 'Simpan sekarang; token tidak ditampilkan lagi. Hanya untuk POST /api/hub/worker?action=tick.'};
}

export async function revokeWorkerToken(db: Client, id: unknown, now = Date.now()) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw Error('WORKER_TOKEN_INVALID');
  const r = await db.execute({sql: 'UPDATE hub_worker_tokens_v2 SET revoked_at=? WHERE id=? AND revoked_at IS NULL', args: [new Date(now).toISOString(), id]});
  if (!r.rowsAffected) throw Error('WORKER_TOKEN_INVALID');
  await log(db, null, 'token', 'REVOKED', 'Token pekerja dicabut', now);
  return {revoked: true};
}

/** Validasi bearer token pekerja untuk penjadwal eksternal (tanpa sesi). */
export async function verifyWorkerToken(db: Client, header: string | null, now = Date.now()) {
  if (!header || !/^Bearer [0-9a-f]{64}$/.test(header)) return false;
  if (!(await workerReady(db))) return false;
  const presented = Buffer.from(hashToken(header.slice(7)), 'hex');
  const rows = (await db.execute({sql: 'SELECT id,token_hash FROM hub_worker_tokens_v2 WHERE revoked_at IS NULL', args: []})).rows;
  for (const r of rows) {
    const stored = Buffer.from(String(r.token_hash), 'hex');
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) {
      await db.execute({sql: 'UPDATE hub_worker_tokens_v2 SET last_used_at=? WHERE id=?', args: [new Date(now).toISOString(), String(r.id)]}).catch(() => {});
      return true;
    }
  }
  return false;
}
