import type { Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import manifest from '../../../../config/ntb-government-sources.json';

export type GovernmentSource = {
  id: string; name: string; jurisdiction: string; region: string;
  requestedUrl: string; sourceKind: 'government_website'; enabled: false;
};

export function governmentManifest(): GovernmentSource[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  return manifest.items.map(item => {
    if (item.sourceKind !== 'government_website' || item.enabled !== false || item.region !== 'NTB') throw new Error('MANIFEST_INVALID');
    const url = normalizeSourceUrl(item.requestedUrl);
    governmentDomain(url);
    if (seenIds.has(item.id) || seenUrls.has(url)) throw new Error('MANIFEST_DUPLICATE');
    seenIds.add(item.id); seenUrls.add(url);
    return { ...item, sourceKind: 'government_website', enabled: false };
  });
}

/** Only exact, conservative URL normalization; never guess that query URLs are equivalent. */
export function normalizeSourceUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('URL_INVALID'); }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || !host.includes('.') || /\.(?:localhost|local|internal)$/.test(host)) throw new Error('URL_INVALID');
  if (ipaddr.isValid(host) && ipaddr.process(host).range() !== 'unicast') throw new Error('URL_INVALID');
  return u.href;
}

export function governmentDomain(raw: string): string {
  const parts = new URL(raw).hostname.toLowerCase().split('.');
  if (parts.length < 3 || parts.at(-2) !== 'go' || parts.at(-1) !== 'id') throw new Error('DOMAIN_INVALID');
  return parts.slice(-3).join('.');
}

/** Add a declared source without contacting it or treating it as verified/active. */
export async function addManualSource(db: Client, input: { name: unknown; jurisdiction: unknown; region: unknown; url: unknown; kind: unknown }) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200 ||
      typeof input.jurisdiction !== 'string' || !input.jurisdiction.trim() || input.jurisdiction.trim().length > 200 ||
      typeof input.region !== 'string' || !['NTB', 'Bali', 'NTT', 'Nasional', 'Lainnya'].includes(input.region) ||
      typeof input.url !== 'string' || input.url.length > 2000 || !['rss', 'government_website'].includes(String(input.kind))) throw new Error('SOURCE_INVALID');
  const url = normalizeSourceUrl(input.url.trim());
  const kind = String(input.kind);
  const domain = kind === 'government_website' ? governmentDomain(url) : new URL(url).hostname.toLowerCase();
  const tx = await db.transaction('write');
  try {
    const existing = (await tx.execute({ sql: 'SELECT id FROM hub_sources WHERE normalized_url=? LIMIT 1', args: [url] })).rows[0];
    if (existing) throw new Error('SOURCE_DUPLICATE');
    if (kind === 'government_website' && (await tx.execute({ sql: "SELECT id FROM hub_sources WHERE publisher_domain=? AND source_kind='government_website' LIMIT 1", args: [domain] })).rows.length) throw new Error('SOURCE_POSSIBLE_DUPLICATE');
    const id = randomUUID(), now = new Date().toISOString();
    await tx.execute({ sql: `INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,discovered_type,rights_status,is_active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'unverified','unknown',0,?,?)`, args: [id, input.name.trim(), input.jurisdiction.trim(), input.region, input.url.trim(), url, domain, kind, now, now] });
    await tx.commit();
    return { id, active: false, verified: false };
  } catch (error) { await tx.rollback(); throw error; }
}

/**
 * Explicit operator action. Preserve edits/status: no upsert update, no activation,
 * no RSS label for HTML. A same-government-domain conflict is reported, not merged.
 */
export async function seedGovernmentSources(db: Client, entries = governmentManifest()) {
  const tx = await db.transaction('write');
  const results: { id: string; status: 'inserted' | 'existing' | 'possible_duplicate'; existingId?: string }[] = [];
  try {
    for (const entry of entries) {
      if (entry.enabled !== false || entry.sourceKind !== 'government_website' || entry.region !== 'NTB') throw new Error('MANIFEST_INVALID');
      const url = normalizeSourceUrl(entry.requestedUrl);
      const domain = governmentDomain(url);
      const exact = await tx.execute({ sql: 'SELECT id FROM hub_sources WHERE id = ? OR normalized_url = ? LIMIT 1', args: [entry.id, url] });
      if (exact.rows.length) {
        results.push({ id: entry.id, status: 'existing', existingId: String(exact.rows[0].id) });
        continue;
      }
      const possible = await tx.execute({ sql: 'SELECT id FROM hub_sources WHERE publisher_domain = ? LIMIT 1', args: [domain] });
      if (possible.rows.length) {
        results.push({ id: entry.id, status: 'possible_duplicate', existingId: String(possible.rows[0].id) });
        continue;
      }
      const now = new Date().toISOString();
      await tx.execute({ sql: `INSERT INTO hub_sources
        (id, name, jurisdiction, region, requested_url, normalized_url, publisher_domain, source_kind, discovered_type, rights_status, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'government_website', 'unverified', 'unknown', 0, ?, ?)`,
        args: [entry.id, entry.name, entry.jurisdiction, entry.region, entry.requestedUrl, url, domain, now, now] });
      results.push({ id: entry.id, status: 'inserted' });
    }
    await tx.commit();
    return results;
  } catch (error) { await tx.rollback(); throw error; }
}

/**
 * Menandai status hak sumber. Ini keputusan pemilik, bukan tebakan sistem:
 * `permission_confirmed` hanya boleh dipilih bila pemilik sudah memastikan izinnya.
 * Setiap perubahan dicatat (waktu + pelaku) agar dapat diaudit.
 */
export const RIGHTS_STATUSES = ['permission_confirmed', 'metadata_only', 'unknown'] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export async function setSourceRights(db: Client, id: unknown, status: unknown, actor: string, now = Date.now()) {
  if (typeof id !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(id)) throw new Error('SOURCE_INVALID');
  if (!RIGHTS_STATUSES.includes(status as RightsStatus)) throw new Error('RIGHTS_INVALID');
  const row = (await db.execute({ sql: 'SELECT id,name,source_kind,rights_status,is_active FROM hub_sources WHERE id=?', args: [id] })).rows[0];
  if (!row) throw new Error('SOURCE_NOT_FOUND');
  const stamp = new Date(now).toISOString();
  await db.execute({ sql: 'UPDATE hub_sources SET rights_status=?,updated_at=? WHERE id=?', args: [String(status), stamp, id] });
  await db.execute(`CREATE TABLE IF NOT EXISTS hub_source_rights_log_v2(
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
    actor TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await db.execute({ sql: 'INSERT INTO hub_source_rights_log_v2(id,source_id,from_status,to_status,actor,created_at) VALUES(?,?,?,?,?,?)',
    args: [randomUUID(), id, row.rights_status ? String(row.rights_status) : null, String(status), actor.slice(0, 100), stamp] });
  return { id, name: String(row.name), sourceKind: String(row.source_kind), active: Number(row.is_active) === 1, from: row.rights_status ? String(row.rights_status) : null, to: String(status), at: stamp };
}

export async function listSourceRightsLog(db: Client, limit = 20) {
  try {
    return (await db.execute({ sql: 'SELECT source_id,from_status,to_status,actor,created_at FROM hub_source_rights_log_v2 ORDER BY created_at DESC LIMIT ?', args: [Math.min(50, Math.max(1, limit))] })).rows
      .map(r => ({ sourceId: String(r.source_id), from: r.from_status ? String(r.from_status) : null, to: String(r.to_status), actor: String(r.actor), at: String(r.created_at) }));
  } catch { return []; }
}
