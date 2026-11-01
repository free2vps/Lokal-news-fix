type Env = Readonly<Record<string, string | undefined>>;

/**
 * Guard the specific Preview bootstrap target. The database name and Turso
 * domain must match before the app sends the server-side token anywhere.
 * This is a safety check, not cryptographic proof of the Turso organization.
 */
export function bootstrapTargetMatches(env: Env): boolean {
  const name = env.HUB_BOOTSTRAP_EXPECTED_DATABASE?.trim().toLowerCase();
  const rawUrl = env.HUB_DATABASE_URL?.trim();
  if (!name || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name) || !rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return ['libsql:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && (!url.port || url.port === '443') &&
      (url.pathname === '' || url.pathname === '/') &&
      host.startsWith(name + '-') && host.endsWith('.turso.io');
  } catch { return false; }
}
