import type { Client } from '@libsql/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { NO_STORE, errorJson, invalidMutation, readJson } from '../security/http';
import { PREVIEW_INITIAL_SQL } from './bootstrap-sql';
import { bootstrapTargetMatches } from './target';
export { bootstrapTargetMatches } from './target';

type Env = Readonly<Record<string, string | undefined>>;

/** All four server-side checks are required. Missing Vercel system metadata fails closed. */
export function canBootstrapPreview(env: Env = process.env): boolean {
  return env.VERCEL === '1' && env.VERCEL_ENV === 'preview' &&
    env.VERCEL_GIT_COMMIT_REF === 'webhub' && env.HUB_BOOTSTRAP_ALLOW === 'true';
}

function validSetupSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(secret);
}
function tokenMatches(provided: unknown, expected: unknown): boolean {
  if (!validSetupSecret(provided) || !validSetupSecret(expected)) return false;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * One explicit, guarded initialization only. The emptiness check, DDL, seed and
 * verification are in the same write transaction. Any existing user object makes
 * this operation refuse to proceed; it never drops, updates or deletes data.
 */
export async function bootstrapEmptyDatabase(db: Client): Promise<'initialized' | 'not_empty'> {
  const tx = await db.transaction('write');
  try {
    const existing = await tx.execute("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index','trigger','view') LIMIT 1");
    if (existing.rows.length) {
      await tx.rollback();
      return 'not_empty';
    }
    await tx.executeMultiple(PREVIEW_INITIAL_SQL);
    const check = await tx.execute(`SELECT
      (SELECT count(*) FROM hub_sources) AS source_count,
      (SELECT count(*) FROM hub_sources WHERE is_active != 0 OR discovered_type != 'unverified' OR rights_status != 'unknown') AS unsafe_sources,
      (SELECT count(*) FROM hub_admin_credentials) AS account_count,
      (SELECT count(*) FROM hub_items) AS item_count,
      (SELECT count(*) FROM hub_schema_migrations WHERE version='001_initial') AS migration_count`);
    const row = check.rows[0];
    if (!row || Number(row.source_count) !== 11 || Number(row.unsafe_sources) !== 0 ||
        Number(row.account_count) !== 0 || Number(row.item_count) !== 0 || Number(row.migration_count) !== 1) {
      throw new Error('BOOTSTRAP_VERIFICATION_FAILED');
    }
    await tx.commit();
    return 'initialized';
  } catch (error) {
    if (!tx.closed) await tx.rollback().catch(() => undefined);
    throw error;
  } finally { tx.close(); }
}

/** Dependency injection keeps route tests independent of live Turso credentials. */
export async function handlePreviewBootstrap(
  request: Request,
  options: { env: Env; getDb: () => Client },
): Promise<Response> {
  if (!canBootstrapPreview(options.env)) return errorJson('Tidak tersedia.', 404);
  const rejected = invalidMutation(request); if (rejected) return rejected;
  if (!validSetupSecret(options.env.HUB_SETUP_TOKEN)) {
    return errorJson('Token pengaturan server belum tersedia atau formatnya tidak aman.', 503);
  }
  let body: Record<string, unknown>;
  try { body = await readJson(request); }
  catch { return errorJson('Permintaan tidak valid atau terlalu besar.', 400); }
  if (!tokenMatches(body.token, options.env.HUB_SETUP_TOKEN)) {
    return errorJson('Token pengaturan tidak valid.', 401);
  }
  if (body.confirm !== 'SIAPKAN DATABASE PREVIEW') {
    return errorJson('Konfirmasi database baru dan kosong diperlukan.', 400);
  }
  if (!bootstrapTargetMatches(options.env)) {
    return errorJson('Target database Preview tidak sesuai. Periksa URL dan nama database di pengaturan server.', 503);
  }
  try {
    const result = await bootstrapEmptyDatabase(options.getDb());
    if (result === 'not_empty') {
      return errorJson('Database tidak kosong. Tidak ada skema yang dijalankan; periksa target sebelum melanjutkan.', 409);
    }
    return NextResponse.json({ ok: true, sources: 11, active: 0 }, { headers: NO_STORE });
  } catch {
    // A network interruption after COMMIT can make the outcome uncertain.
    return errorJson('Inisialisasi gagal atau hasilnya belum pasti. Periksa koneksi dan status sebelum mencoba lagi.', 503);
  }
}
