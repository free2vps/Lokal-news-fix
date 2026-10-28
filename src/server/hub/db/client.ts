import { createClient, type Client } from '@libsql/client';

let instance: Client | undefined;

/** Lazy connection: neither schema creation nor collection runs during a request. */
export function getHubDb(): Client {
  if (instance) return instance;
  const url = process.env.HUB_DATABASE_URL?.trim();
  if (!url) throw new Error('HUB_DB_NOT_CONFIGURED');
  if (url.startsWith('file:')) {
    if (process.env.HUB_ALLOW_LOCAL_DB !== 'true' || process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      throw new Error('HUB_LOCAL_DB_NOT_ALLOWED');
    }
    instance = createClient({ url });
    return instance;
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('HUB_DB_URL_INVALID'); }
  if (!['libsql:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('HUB_DB_URL_INVALID');
  }
  const authToken = process.env.HUB_DATABASE_AUTH_TOKEN;
  if (!authToken) throw new Error('HUB_DB_TOKEN_NOT_CONFIGURED');
  instance = createClient({ url, authToken });
  return instance;
}
