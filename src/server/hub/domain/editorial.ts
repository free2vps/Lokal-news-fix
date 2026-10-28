import type { Client, Transaction } from '@libsql/client';
import { createHash, randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';

export type IncomingItem = {
  sourceId: string; externalId?: string | null; url: string; title: string;
  snippet?: string | null; sourcePublishedAt?: string | null; sourceDateRaw?: string | null;
};
type ItemRow = {
  id: string; source_id: string; identity_key: string; original_url: string; normalized_original_url: string;
  source_title: string; source_snippet: string | null; source_published_at: string | null; source_date_raw: string | null;
  first_seen_at: string; last_seen_at: string; editorial_title: string | null; editorial_summary: string | null;
  editorial_category: string | null; version: number; review_state: string; approved_version: number | null;
};
function rowItem(value: unknown): ItemRow { return value as ItemRow; }
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function bounded(value: unknown, max: number, required = false): string | null {
  if (value == null && !required) return null;
  if (typeof value !== 'string') throw new Error('INPUT_INVALID');
  const clean = value.replace(/\s+/g, ' ').trim();
  if ((required && !clean) || clean.length > max) throw new Error('INPUT_INVALID');
  return clean || null;
}
/** Validate identity without making any DNS or HTTP request. A fetcher must do its own SSRF checks. */
export function normalizeArticleUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('URL_INVALID'); }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !host.includes('.') || host === 'localhost' || /\.(?:localhost|local|internal)$/.test(host)) throw new Error('URL_INVALID');
  if (ipaddr.isValid(host) && ipaddr.process(host).range() !== 'unicast') throw new Error('URL_INVALID');
  u.hash = '';
  return u.href;
}
/** Only explicitly zoned ISO timestamps are accepted; preserve the raw source separately. */
export function sourceTime(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('DATE_INVALID');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) throw new Error('DATE_NEEDS_EXPLICIT_TIMEZONE');
  const [, y, mo, d, h, min, s, , zone] = m;
  let offset = 0;
  if (zone !== 'Z') {
    const hh = Number(zone.slice(1, 3)), mm = Number(zone.slice(4, 6));
    if (hh > 14 || mm > 59 || (hh === 14 && mm !== 0)) throw new Error('DATE_INVALID');
    offset = (hh * 60 + mm) * (zone[0] === '+' ? 1 : -1);
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error('DATE_INVALID');
  const local = new Date(instant + offset * 60_000);
  if (local.getUTCFullYear() !== Number(y) || local.getUTCMonth() + 1 !== Number(mo) || local.getUTCDate() !== Number(d) || local.getUTCHours() !== Number(h) || local.getUTCMinutes() !== Number(min) || local.getUTCSeconds() !== Number(s)) throw new Error('DATE_INVALID');
  return new Date(instant).toISOString();
}
function identityOf(input: IncomingItem, normalizedUrl: string) {
  const externalId = bounded(input.externalId, 500);
  return externalId ? `guid:${externalId}` : `url:${normalizedUrl}`;
}
async function supersede(tx: Transaction, itemId: string) {
  await tx.execute({ sql: "UPDATE hub_publish_outbox SET status='superseded' WHERE item_id=? AND status='queued'", args: [itemId] });
}

/** Internal business function only. No collector endpoint or fetching is enabled. */
export async function acceptSourceItem(db: Client, input: IncomingItem) {
  const sourceId = bounded(input.sourceId, 200, true)!;
  const title = bounded(input.title, 300, true)!;
  const snippet = bounded(input.snippet, 1500);
  const dateRaw = bounded(input.sourceDateRaw, 150);
  const published = sourceTime(input.sourcePublishedAt);
  const normalized = normalizeArticleUrl(input.url);
  const identity = identityOf(input, normalized);
  const fingerprint = hash(JSON.stringify([identity, normalized, title, snippet, published, dateRaw]));
  const now = new Date().toISOString();
  const tx = await db.transaction('write');
  try {
    const source = (await tx.execute({ sql: 'SELECT id,is_active,discovered_type,rights_status FROM hub_sources WHERE id=?', args: [sourceId] })).rows[0];
    if (!source || Number(source.is_active) !== 1 || String(source.discovered_type) === 'unverified' || String(source.rights_status) === 'unknown') throw new Error('SOURCE_NOT_READY');
    const found = (await tx.execute({ sql: 'SELECT * FROM hub_items WHERE source_id=? AND identity_key=?', args: [sourceId, identity] })).rows[0];
    if (!found) {
      const collisions = (await tx.execute({ sql: 'SELECT id,review_state FROM hub_items WHERE source_id=? AND normalized_original_url=?', args: [sourceId, normalized] })).rows;
      const id = randomUUID(), state = collisions.length ? 'identity_review' : 'pending_review';
      await tx.execute({ sql: `INSERT INTO hub_items(id,source_id,identity_key,original_url,normalized_original_url,source_title,source_snippet,source_published_at,source_date_raw,first_seen_at,last_seen_at,review_state,version)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`, args: [id, sourceId, identity, input.url, normalized, title, snippet, published, dateRaw, now, now, state] });
      await tx.execute({ sql: 'INSERT INTO hub_item_observations(id,item_id,fingerprint,observed_at,source_title,source_snippet,original_url,source_published_at,source_date_raw,conflict) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [randomUUID(), id, fingerprint, now, title, snippet, input.url, published, dateRaw, collisions.length ? 1 : 0] });
      for (const collision of collisions) {
        const existingId = String(collision.id);
        if (String(collision.review_state) !== 'identity_review') {
          await tx.execute({ sql: "UPDATE hub_items SET review_state='identity_review',approved_version=NULL,version=version+1 WHERE id=?", args: [existingId] });
          await supersede(tx, existingId);
        }
      }
      await tx.commit();
      return { id, status: collisions.length ? 'identity_review' as const : 'inserted' as const };
    }
    const item = rowItem(found);
    const conflict = item.normalized_original_url !== normalized || (!!item.source_published_at && !!published && item.source_published_at !== published);
    const observation = await tx.execute({ sql: `INSERT INTO hub_item_observations(id,item_id,fingerprint,observed_at,source_title,source_snippet,original_url,source_published_at,source_date_raw,conflict)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id,fingerprint) DO NOTHING`, args: [randomUUID(), item.id, fingerprint, now, title, snippet, input.url, published, dateRaw, conflict ? 1 : 0] });
    if (conflict && observation.rowsAffected) {
      await tx.execute({ sql: "UPDATE hub_items SET last_seen_at=?,review_state='identity_review',approved_version=NULL,version=version+1 WHERE id=?", args: [now, item.id] });
      await supersede(tx, item.id);
    } else if (!conflict && observation.rowsAffected) {
      const effectivePublished = item.source_published_at || published;
      const effectiveRaw = item.source_date_raw || dateRaw;
      const changed = item.source_title !== title || item.source_snippet !== snippet || item.source_published_at !== effectivePublished;
      if (changed) {
        await tx.execute({ sql: `UPDATE hub_items SET source_title=?,source_snippet=?,source_published_at=?,source_date_raw=?,last_seen_at=?,version=version+1,approved_version=NULL,
          review_state=CASE WHEN review_state='identity_review' THEN 'identity_review' ELSE 'pending_review' END WHERE id=?`, args: [title, snippet, effectivePublished, effectiveRaw, now, item.id] });
        await supersede(tx, item.id);
      } else await tx.execute({ sql: 'UPDATE hub_items SET last_seen_at=?,source_date_raw=? WHERE id=?', args: [now, effectiveRaw, item.id] });
    } else await tx.execute({ sql: 'UPDATE hub_items SET last_seen_at=? WHERE id=?', args: [now, item.id] });
    await tx.commit();
    return { id: item.id, status: conflict ? 'identity_review' as const : observation.rowsAffected ? 'updated' as const : 'duplicate' as const };
  } catch (error) { await tx.rollback(); throw error; }
}

type EditInput = { id: string; expectedVersion: number; editorialTitle: string | null; editorialSummary: string | null; editorialCategory: string | null };
export async function editEditorial(db: Client, input: EditInput) {
  const title = bounded(input.editorialTitle, 300), summary = bounded(input.editorialSummary, 1500), category = bounded(input.editorialCategory, 100);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error('VERSION_INVALID');
  const tx = await db.transaction('write');
  try {
    const found = (await tx.execute({ sql: 'SELECT * FROM hub_items WHERE id=?', args: [input.id] })).rows[0];
    if (!found) throw new Error('NOT_FOUND');
    const item = rowItem(found);
    if (Number(item.version) !== input.expectedVersion) throw new Error('VERSION_CONFLICT');
    if (item.editorial_title === title && item.editorial_summary === summary && item.editorial_category === category) { await tx.commit(); return { version: Number(item.version), changed: false }; }
    await tx.execute({ sql: `UPDATE hub_items SET editorial_title=?,editorial_summary=?,editorial_category=?,version=version+1,approved_version=NULL,
      review_state=CASE WHEN review_state='identity_review' THEN 'identity_review' ELSE 'pending_review' END WHERE id=? AND version=?`, args: [title, summary, category, input.id, input.expectedVersion] });
    await supersede(tx, input.id);
    await tx.commit();
    return { version: input.expectedVersion + 1, changed: true };
  } catch (error) { await tx.rollback(); throw error; }
}
export async function approveEditorial(db: Client, id: string, expectedVersion: number, actor: string) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !bounded(actor, 100, true)) throw new Error('INPUT_INVALID');
  const tx = await db.transaction('write');
  try {
    const found = (await tx.execute({ sql: 'SELECT * FROM hub_items WHERE id=?', args: [id] })).rows[0];
    if (!found) throw new Error('NOT_FOUND');
    const item = rowItem(found);
    if (Number(item.version) !== expectedVersion) throw new Error('VERSION_CONFLICT');
    if (item.review_state === 'approved' && Number(item.approved_version) === expectedVersion) { await tx.commit(); return { version: expectedVersion, alreadyApproved: true }; }
    if (item.review_state === 'identity_review') throw new Error('IDENTITY_REVIEW_REQUIRED');
    if (!item.source_published_at) throw new Error('SOURCE_DATE_REQUIRED');
    try {sourceTime(item.source_published_at);} catch {throw new Error('SOURCE_DATE_REQUIRED');}
    const snapshot = JSON.stringify({ id: item.id, sourceId: item.source_id, originalUrl: item.original_url, sourceTitle: item.source_title, sourceSnippet: item.source_snippet, sourcePublishedAt: item.source_published_at, sourceDateRaw: item.source_date_raw, editorialTitle: item.editorial_title, editorialSummary: item.editorial_summary, editorialCategory: item.editorial_category, version: Number(item.version) });
    await tx.execute({ sql: 'INSERT INTO hub_item_approvals(item_id,version,snapshot_json,approved_at,approved_by) VALUES(?,?,?,?,?)', args: [id, expectedVersion, snapshot, new Date().toISOString(), actor] });
    await tx.execute({ sql: "UPDATE hub_items SET review_state='approved',approved_version=? WHERE id=? AND version=?", args: [expectedVersion, id, expectedVersion] });
    await tx.commit();
    return { version: expectedVersion, alreadyApproved: false };
  } catch (error) { await tx.rollback(); throw error; }
}
/** Records an intent only; no delivery adapter or worker is installed. */
export async function queuePublication(db: Client, id: string, expectedVersion: number) {
  const tx = await db.transaction('write');
  try {
    const row = (await tx.execute({ sql: `SELECT i.version,i.review_state,i.approved_version,s.rights_status,a.snapshot_json
      FROM hub_items i JOIN hub_sources s ON s.id=i.source_id LEFT JOIN hub_item_approvals a ON a.item_id=i.id AND a.version=i.approved_version WHERE i.id=?`, args: [id] })).rows[0];
    if (!row) throw new Error('NOT_FOUND');
    if (Number(row.version) !== expectedVersion || row.review_state !== 'approved' || Number(row.approved_version) !== expectedVersion || !row.snapshot_json) throw new Error('APPROVAL_REQUIRED');
    if (row.rights_status !== 'permission_confirmed') throw new Error('RIGHTS_REQUIRED');
    const key = hash(`publication:${id}:${expectedVersion}`);
    await tx.execute({ sql: "INSERT INTO hub_publish_outbox(id,idempotency_key,item_id,approved_version,snapshot_json,status,created_at) VALUES(?,?,?,?,?,'queued',?) ON CONFLICT(idempotency_key) DO NOTHING", args: [randomUUID(), key, id, expectedVersion, String(row.snapshot_json), new Date().toISOString()] });
    const result = (await tx.execute({ sql: 'SELECT id,status FROM hub_publish_outbox WHERE idempotency_key=?', args: [key] })).rows[0];
    await tx.commit();
    return { id: String(result.id), status: String(result.status), delivered: false };
  } catch (error) { await tx.rollback(); throw error; }
}
