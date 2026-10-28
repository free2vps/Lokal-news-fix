import type { Client } from '@libsql/client';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const SESSION_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function digest(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 64, (error, key) => error ? reject(error) : resolve(key as Buffer)));
}
function constantEqual(a: string, b: string) {
  return timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));
}
function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 200;
}
async function consumeAttempt(db: Client, now: number) {
  // Shared, durable bucket across instances. Deliberately global; a hostile actor can
  // temporarily lock the owner out, so production still needs a managed edge limiter.
  const bucket = `auth:${Math.floor(now / WINDOW_MS)}`;
  const result = await db.execute({
    sql: `INSERT INTO hub_rate_limits(bucket,count) VALUES(?,1)
          ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count`, args: [bucket]
  });
  return Number(result.rows[0]?.count) <= MAX_ATTEMPTS;
}
async function makeSession(db: Client, now: number) {
  const token = randomBytes(32).toString('hex');
  await db.execute({ sql: 'INSERT INTO hub_admin_sessions(token_hash,created_at_ms,expires_at_ms) VALUES(?,?,?)', args: [digest(token), now, now + SESSION_MS] });
  return token;
}
export async function isConfigured(db: Client): Promise<boolean> {
  return (await db.execute("SELECT id FROM hub_admin_credentials WHERE id='owner' LIMIT 1")).rows.length > 0;
}
export async function hasSession(db: Client, token: string | null, now = Date.now()): Promise<boolean> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  return (await db.execute({ sql: 'SELECT token_hash FROM hub_admin_sessions WHERE token_hash=? AND expires_at_ms>? LIMIT 1', args: [digest(token), now] })).rows.length > 0;
}
export async function setupOwner(db: Client, input: { password: unknown; token: unknown }, expectedToken: string | undefined, now = Date.now()) {
  if (!await consumeAttempt(db, now)) return { ok: false as const, code: 'RATE_LIMIT' };
  if (!expectedToken || expectedToken.length < 32) return { ok: false as const, code: 'SETUP_DISABLED' };
  if (await isConfigured(db)) return { ok: false as const, code: 'ALREADY_CONFIGURED' };
  if (typeof input.token !== 'string' || !constantEqual(input.token, expectedToken)) return { ok: false as const, code: 'UNAUTHORIZED' };
  if (!validPassword(input.password)) return { ok: false as const, code: 'PASSWORD_INVALID' };
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(input.password, salt)).toString('hex');
  const inserted = await db.execute({ sql: "INSERT INTO hub_admin_credentials(id,salt,password_hash,created_at) VALUES('owner',?,?,?) ON CONFLICT(id) DO NOTHING", args: [salt, hash, new Date(now).toISOString()] });
  if (!inserted.rowsAffected) return { ok: false as const, code: 'ALREADY_CONFIGURED' };
  return { ok: true as const, session: await makeSession(db, now) };
}
export async function loginOwner(db: Client, password: unknown, now = Date.now()) {
  if (!await consumeAttempt(db, now)) return { ok: false as const, code: 'RATE_LIMIT' };
  const row = (await db.execute("SELECT salt,password_hash FROM hub_admin_credentials WHERE id='owner'")).rows[0];
  // Run scrypt even if the account or password is invalid, within the input cap.
  const candidate = typeof password === 'string' && password.length <= 200 ? password : '';
  const salt = row ? String(row.salt) : '8e1b86e63a90ed82bcb53613633a5ea1';
  const actual = await derive(candidate, salt);
  const expected = row && /^[0-9a-f]{128}$/.test(String(row.password_hash)) ? Buffer.from(String(row.password_hash), 'hex') : Buffer.alloc(64);
  if (!row || !timingSafeEqual(actual, expected)) return { ok: false as const, code: 'UNAUTHORIZED' };
  return { ok: true as const, session: await makeSession(db, now) };
}
export async function logoutOwner(db: Client, token: string | null) {
  if (token && /^[0-9a-f]{64}$/.test(token)) await db.execute({ sql: 'DELETE FROM hub_admin_sessions WHERE token_hash=?', args: [digest(token)] });
}
export const sessionTtlSeconds = SESSION_MS / 1000;
