import { NextResponse } from 'next/server';
import { getHubDb } from '../db/client';
import { hasSession, sessionTtlSeconds } from './auth';

export const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function sessionCookie(request: Request): string | null {
  const parts = (request.headers.get('cookie') || '').split(';');
  const found = parts.map(part => part.trim()).find(part => part.startsWith('hub_session='));
  return found ? found.slice('hub_session='.length) : null;
}

function externalUrl(request: Request): URL {
  // Next may construct request.url with its internal bind host (0.0.0.0).
  // The browser's Host still identifies the origin to which its cookie belongs.
  const target = new URL(request.url);
  const host = request.headers.get('host') || target.host;
  if (!host || /[\s/@?#\\]/.test(host)) throw new Error('HOST_INVALID');
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const protocol = target.protocol === 'https:' || forwarded === 'https' ? 'https:' : target.protocol;
  const url = new URL(`${protocol}//${host}/`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('HOST_INVALID');
  return url;
}

export function csrfAllowed(request: Request): boolean {
  if (request.headers.get('x-hub-request') !== '1') return false;
  const raw = request.headers.get('origin');
  if (!raw) return false;
  try {
    const origin = new URL(raw), target = externalUrl(request);
    return !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash && origin.origin === target.origin;
  } catch { return false; }
}

/** Bound the stream even when Content-Length is absent or dishonest. */
export async function readJson(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new Error('BAD_CONTENT_TYPE');
  const declared = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared > maxBytes) throw new Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('BODY_INVALID');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
    chunks.push(value);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('BODY_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('BODY_INVALID');
  return parsed as Record<string, unknown>;
}

function connectionInfo(request: Request) {
  try {
    const url = externalUrl(request);
    const secure = url.protocol === 'https:';
    const localHttp = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return { url, secure, allowed: secure || localHttp };
  } catch { return { url: new URL('http://invalid.local/'), secure: false, allowed: false }; }
}

export function setSession(response: NextResponse, request: Request, token: string, maxAge = sessionTtlSeconds) {
  const { url, secure, allowed } = connectionInfo(request);
  if (!allowed) throw new Error('HTTPS_REQUIRED');
  const preview = secure && url.hostname.endsWith('.e2b.app');
  const cookie = `hub_session=${token}; Path=/; HttpOnly; Max-Age=${maxAge}; ${secure ? 'Secure; ' : ''}SameSite=${preview ? 'None; Partitioned' : 'Strict'}`;
  response.headers.append('Set-Cookie', cookie);
}

export function errorJson(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE });
}
export async function authenticatedDb(request: Request) {
  try {
    const db = getHubDb();
    if (!await hasSession(db, sessionCookie(request))) return { error: errorJson('Silakan masuk sebagai administrator.', 401) } as const;
    return { db } as const;
  } catch { return { error: errorJson('Database Hub belum siap atau tidak dapat diakses.', 503) } as const; }
}
export function invalidMutation(request: Request) {
  if (!connectionInfo(request).allowed) return errorJson('HTTPS wajib digunakan.', 403);
  return !csrfAllowed(request) ? errorJson('Asal atau perlindungan CSRF tidak valid.', 403) : null;
}
