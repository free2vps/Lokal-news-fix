import type {Client} from '@libsql/client';
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {syncRss} from './rss-runtime';
import {profileBatch, profileStatus} from './content-profile';
import {valueBatch, valueStatus} from './editorial-value';
import {runSummaryBatch, summaryStatus} from './ai-summary';
import {enqueuePublished, prepareSocialSchema, socialReady} from './social-pull';
import {getPreferences} from './operations';

/**
 * Langkah 9b: pipeline otomatis tiap 3 jam.
 *
 * Aman dijelaskan begini:
 * - Yang otomatis: tarik RSS → profil konten → nilai editorial → ringkasan (kuota kecil) →
 *   antrean media sosial → (opsional) terbitkan artikel yang SUDAH disetujui.
 * - Yang tetap manusia: menyetujui berita dan menyalakan izin terbit (allowlist).
 * - Penjadwal: endpoint token ini dipanggil skeduler eksternal (Make/GitHub Actions/cron-job.org),
 *   karena cron Vercel Hobby hanya boleh sekali sehari.
 */
export const AUTOMATION_POLICY = {
  intervalHours: 3,
  intervalLabel: 'setiap 3 jam (dipicu skeduler eksternal)',
  rssSourcesPerRun: 2,
  profilesPerRun: 25,
  valuesPerRun: 25,
  summariesPerRun: 2,
  budgetMs: 45000,
  cronVercelHobby: 'tidak dipakai — Hobby hanya mengizinkan cron 1x/hari; perlu Pro untuk sub-daily',
  approvalRemainsHuman: true,
  notes: [
    'Pipeline tidak pernah menyetujui berita sendiri; persetujuan tetap manual di menu Berita.',
    'Ringkasan AI dibatasi 2 item/putaran agar kuota 20 percobaan/hari tidak habis oleh jadwal 3 jam.',
    'RSS diambil maksimal 2 sumber per putaran (masing-masing 10 item) agar waktu respons tetap wajar.',
    'Semua langkah toleran kegagalan: satu sumber gagal tidak menghentikan langkah lain.',
  ],
} as const;

const clampInt = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d; };
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function prepareAutomationSchema(db: Client) {
  await prepareSocialSchema(db);
  await db.execute(`CREATE TABLE IF NOT EXISTS hub_automation_runs_v2(
    id TEXT PRIMARY KEY, trigger TEXT NOT NULL, status TEXT NOT NULL,
    steps_json TEXT NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  await db.execute('CREATE TABLE IF NOT EXISTS hub_automation_tokens_v2(id TEXT PRIMARY KEY,label TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,revoked_at TEXT,last_used_at TEXT)');
  return automationStatus(db);
}

export async function automationReady(db: Client) {
  return (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_automation_runs_v2'")).rows.length === 1;
}

async function nextRssSources(db: Client, limit: number) {
  const rows = (await db.execute({sql: `SELECT s.id,s.name FROM hub_sources s
    LEFT JOIN (SELECT kind, max(started_at) last_at FROM hub_logs_v3 GROUP BY kind) l ON l.kind='rss:'||s.id
    WHERE s.source_kind='rss' AND s.is_active=1 AND s.discovered_type='rss' AND s.rights_status<>'unknown'
    ORDER BY CASE WHEN l.last_at IS NULL THEN 0 ELSE 1 END, l.last_at, s.id LIMIT ?`, args: [limit]})).rows;
  return rows.map(r => ({id: String(r.id), name: String(r.name)}));
}

export type StepResult = {step: string; ok: boolean; detail: string; count?: number};
export type AutomationOptions = {now?: number; trigger?: string; master?: string; deliver?: unknown; maxSummaries?: number};

export async function runAutomation(db: Client, opts: AutomationOptions = {}) {
  const started = Date.now();
  const now = opts.now ?? started;
  const steps: StepResult[] = [];
  const push = (step: string, ok: boolean, detail: string, count?: number) => steps.push({step, ok, detail, count});

  // 1. RSS
  let rss = {sources: 0, inserted: 0, failed: 0};
  try {
    for (const src of await nextRssSources(db, AUTOMATION_POLICY.rssSourcesPerRun)) {
      try { const out = await syncRss(db, src.id); const inserted = Number((out as {inserted?: number})?.inserted || 0); rss.sources += 1; rss.inserted += inserted; }
      catch { rss.failed += 1; }
    }
    push('rss', true, rss.sources ? `${rss.sources} sumber, ${rss.inserted} berita baru${rss.failed ? `, ${rss.failed} gagal` : ''}` : 'tidak ada sumber RSS aktif dengan hak metadata — lewati', rss.inserted);
  } catch { push('rss', false, 'gagal membaca daftar sumber', 0); }

  // 2. Profil
  try {
    if ((await profileStatus(db)).ready) { const out = await profileBatch(db, ''); push('profiles', true, `${out.processed} diperiksa, ${out.changed} diperbarui`, out.processed); }
    else push('profiles', false, 'tabel profil belum disiapkan (Tahap 2)', 0);
  } catch { push('profiles', false, 'gagal membuat profil', 0); }

  // 3. Nilai editorial
  try {
    if ((await valueStatus(db)).ready) { const out = await valueBatch(db, ''); push('values', true, `${out.processed} dinilai, ${out.changed} diperbarui`, out.processed); }
    else push('values', false, 'tabel nilai belum disiapkan (Tahap 5)', 0);
  } catch { push('values', false, 'gagal menilai', 0); }

  // 4. Ringkasan (hemat token)
  try {
    const st = await summaryStatus(db);
    if (!st.ready) push('summaries', false, 'tabel ringkasan belum disiapkan (Tahap 4)', 0);
    else {
      const hours = (await getPreferences(db)).freshnessHours;
      const out = await runSummaryBatch(db, {maxItems: clampInt(opts.maxSummaries, 1, 5, AUTOMATION_POLICY.summariesPerRun), freshnessHours: hours, master: opts.master, now});
      push('summaries', true, `${out.written} ringkasan (${out.kindCounts?.extractive || 0} ekstraktif, ${out.kindCounts?.ai || 0} AI, ${out.kindCounts?.reuse || 0} cache)`, out.written);
    }
  } catch { push('summaries', false, 'ringkasan dilewati (kuota/izin/penyedia belum siap)', 0); }

  // 5. Terbit terjadwal (hanya bila dinyalakan pemilik; hanya artikel yang sudah disetujui)
  let publish: Record<string, unknown> | null = null;
  try {
    const mod = await import('./publish-policy');
    const st = await mod.publishStatus(db);
    if (!st.ready) push('publish', false, 'tabel autopublish belum disiapkan (Tahap 8)', 0);
    else if (!st.config.scheduleEnabled) push('publish', true, 'terbit terjadwal nonaktif — dilewati', 0);
    else {
      const {targetConfigured} = mod;
      const delivery = await import('./publish-delivery');
      const deliver = (opts.deliver as never) || (targetConfigured() ? delivery.supabaseDeliver() : mod.defaultDeliver());
      const out = await mod.publishScheduled(db, 'scheduler:3h', deliver, now);
      publish = out as unknown as Record<string, unknown>;
      push('publish', true, out.skipped ? `dilewati: ${out.reason}` : `${out.published} terbit, ${out.failed} gagal`, out.published);
    }
  } catch (e) { push('publish', false, `gagal: ${(e as Error).message.replace(/[^A-Z_]/g, '').slice(0, 40)}`, 0); }

  // 6. Antrean media sosial — dijalankan SETELAH penerbitan supaya artikel yang baru terbit
  //    pada putaran ini langsung bisa ditarik Make dengan trigger yang sama (satu trigger, dua proses).
  try {
    if (await socialReady(db)) { const out = await enqueuePublished(db, now); push('social_queue', true, `${out.inserted} artikel masuk antrean media sosial`, out.inserted); }
    else push('social_queue', false, 'tabel antrean sosial belum disiapkan', 0);
  } catch { push('social_queue', false, 'gagal mengisi antrean sosial', 0); }

  const duration = Date.now() - started;
  const status = steps.every(s => s.ok) ? 'ok' : steps.some(s => s.ok) ? 'partial' : 'failed';
  const trigger = String(opts.trigger || 'manual').slice(0, 40);
  await db.execute({sql: 'INSERT INTO hub_automation_runs_v2(id,trigger,status,steps_json,duration_ms,created_at) VALUES(?,?,?,?,?,?)',
    args: [randomUUID(), trigger, status, JSON.stringify(steps), duration, new Date(now).toISOString()]});
  return {status, runAt: new Date(now).toISOString(), durationMs: duration, steps, publish, intervalHours: AUTOMATION_POLICY.intervalHours, approvalRemainsHuman: true};
}

export async function automationStatus(db: Client) {
  if (!(await automationReady(db))) return {ready: false, runs: [], tokens: [], policy: AUTOMATION_POLICY};
  const runs = (await db.execute('SELECT trigger,status,steps_json,duration_ms,created_at FROM hub_automation_runs_v2 ORDER BY created_at DESC LIMIT 10')).rows.map(r => ({
    trigger: String(r.trigger), status: String(r.status), durationMs: Number(r.duration_ms), at: String(r.created_at),
    steps: (() => { try { return JSON.parse(String(r.steps_json)); } catch { return []; } })(),
  }));
  const tokens = (await db.execute('SELECT id,label,created_at,revoked_at,last_used_at FROM hub_automation_tokens_v2 ORDER BY created_at DESC')).rows.map(r => ({id: String(r.id), label: String(r.label), createdAt: String(r.created_at), revoked: Boolean(r.revoked_at), lastUsedAt: r.last_used_at ? String(r.last_used_at) : null}));
  const last = runs[0] || null;
  return {ready: true, runs, tokens, last, policy: AUTOMATION_POLICY, intervalHours: AUTOMATION_POLICY.intervalHours};
}

export async function issueAutomationToken(db: Client, label: unknown, now = Date.now()) {
  if (!(await automationReady(db))) throw Error('AUTOMATION_NOT_READY');
  const clean = typeof label === 'string' && label.trim().length >= 2 && label.trim().length <= 60 ? label.trim() : 'penjadwal 3 jam';
  const token = randomBytes(32).toString('hex');
  await db.execute({sql: 'INSERT INTO hub_automation_tokens_v2(id,label,token_hash,created_at) VALUES(?,?,?,?)', args: [randomUUID(), clean, hashToken(token), new Date(now).toISOString()]});
  return {token, label: clean, note: 'Simpan sekarang; hanya untuk POST /api/hub/automation?action=run.'};
}

export async function revokeAutomationToken(db: Client, id: unknown, now = Date.now()) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw Error('AUTOMATION_TOKEN_INVALID');
  const r = await db.execute({sql: 'UPDATE hub_automation_tokens_v2 SET revoked_at=? WHERE id=? AND revoked_at IS NULL', args: [new Date(now).toISOString(), id]});
  if (!r.rowsAffected) throw Error('AUTOMATION_TOKEN_INVALID');
  return {revoked: true};
}

export async function verifyAutomationToken(db: Client, header: string | null, now = Date.now()) {
  if (!header || !/^Bearer [0-9a-f]{64}$/.test(header)) return false;
  if (!(await automationReady(db))) return false;
  const presented = Buffer.from(hashToken(header.slice(7)), 'hex');
  for (const r of (await db.execute({sql: 'SELECT id,token_hash FROM hub_automation_tokens_v2 WHERE revoked_at IS NULL', args: []})).rows) {
    const stored = Buffer.from(String(r.token_hash), 'hex');
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) {
      await db.execute({sql: 'UPDATE hub_automation_tokens_v2 SET last_used_at=? WHERE id=?', args: [new Date(now).toISOString(), String(r.id)]}).catch(() => {});
      return true;
    }
  }
  return false;
}
