import {createHash} from 'node:crypto';
import {mapHubArticle} from '@/lib/content-hub/mapping';
import {slugify} from '@/lib/utils';
import {topicOf} from './topic';
import {resolveDeliveryTarget} from './delivery-target';
import type {Deliver, DeliveryResult} from './publish-policy';

/**
 * Adapter pengiriman ke tabel `articles` di situs (Supabase).
 * Kredensial HANYA dari environment backend dan sengaja memakai nama terpisah dari variabel
 * publik situs, sehingga patch ini tidak menyentuh Supabase website yang sudah berjalan.
 * Tanpa kredensial, tidak ada permintaan jaringan yang dibuat.
 */
export const DELIVERY_ENV = {url: 'HUB_WEBSITE_SUPABASE_URL', key: 'HUB_WEBSITE_SERVICE_ROLE_KEY'} as const;

/** Slug artikel situs, dihitung sama seperti mapping artikel (tanpa syarat kesegaran tanggal). */
export function articleSlug(snapshot: Record<string, unknown>) {
  const title = String(snapshot.editorialTitle || snapshot.sourceTitle || '').slice(0, 500);
  const url = String(snapshot.originalUrl || '');
  if (!title.trim() || !url) return null;
  try { new URL(url); } catch { return null; }
  return `${slugify(title).slice(0, 70)}-hub-${createHash('sha256').update(url).digest('hex').slice(0, 12)}`;
}

export function articleRow(snapshot: Record<string, unknown>) {
  const title = String(snapshot.editorialTitle || snapshot.sourceTitle || '');
  const summary = String(snapshot.editorialSummary || snapshot.sourceSnippet || '');
  const category = String(snapshot.editorialCategory || '') || topicOf({title, summary});
  // Gambar: HANYA URL asli milik penerbit (tidak disalin/di-rehost), dan hanya bila hak sumber
  // sudah dinyatakan oleh pemilik (permission_confirmed). Atribusi diisi nama penerbit.
  const rightsOk = String(snapshot.sourceRights || '') === 'permission_confirmed';
  const image = rightsOk && typeof snapshot.sourceImageUrl === 'string' && /^https:\/\//i.test(snapshot.sourceImageUrl)
    ? String(snapshot.sourceImageUrl) : null;
  const entertainment = /hiburan|film|musik|drakor|dracin|idol|seleb|game/i.test(category);
  return mapHubArticle({
    kind: 'article', title, summary, original_url: snapshot.originalUrl, published_at: snapshot.sourcePublishedAt,
    source_name: String(snapshot.sourceName || ''), original_title: snapshot.sourceTitle, editorial_category: category,
    image_url: image, image_credit: image ? String(snapshot.sourceName || 'Penerbit sumber') : null,
    contentGroup: entertainment ? 'entertainment' : 'news',
  });
}

export function supabaseDeliver(fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Deliver {
  return async (items) => {
    const target = resolveDeliveryTarget(env);
    const base = target.url, key = target.key;
    if (!base || !key) throw Error('PUBLISH_TARGET_NOT_CONFIGURED');
    let origin: URL;
    try { origin = new URL(base); } catch { throw Error('PUBLISH_TARGET_INVALID'); }
    if (origin.protocol !== 'https:' || origin.username || origin.password) throw Error('PUBLISH_TARGET_INVALID');
    const rows = items.map(i => ({item: i, row: articleRow(i.snapshot)})).filter(x => x.row);
    const skipped = items.filter(i => !articleRow(i.snapshot)).map(i => i.id);
    const result: DeliveryResult = {published: [], duplicates: [], failed: skipped.map(id => ({id, code: 'ARTICLE_ROW_INVALID'})), target: 'supabase_articles'};
    if (rows.length) {
      const r = await fetcher(new URL('/rest/v1/articles?on_conflict=source_url&select=id,source_url', origin).href, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: {apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation'},
        body: JSON.stringify(rows.map(x => x.row)),
      });
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw Error(r.status === 409 ? 'PUBLISH_CONFLICT' : 'PUBLISH_HTTP_' + r.status); }
      const payload = await r.text();
      if (payload.length > 200000) throw Error('PUBLISH_RESPONSE_TOO_LARGE');
      const returned = new Map<string, string>();
      try { for (const row of JSON.parse(payload) as {id: string; source_url: string}[]) returned.set(String(row.source_url), String(row.id)); } catch { throw Error('PUBLISH_RESPONSE_INVALID'); }
      for (const x of rows) {
        if (returned.has(String(x.row?.source_url))) result.published.push(x.item.id);
        else result.duplicates.push(x.item.id);
      }
    }
    return result;
  };
}

/**
 * Lengkapi gambar pada artikel yang SUDAH terbit sebelum perbaikan r16.
 *
 * Kenapa perlu: penerbitan memakai `resolution=ignore-duplicates` pada `source_url`, jadi artikel
 * yang telanjur masuk tanpa gambar tidak akan pernah berubah hanya dengan menerbitkan ulang.
 * Snapshot di outbox sudah menyimpan `sourceImageUrl`/`sourceRights` yang benar, jadi gambar bisa
 * dipasang tanpa mengambil apa pun dari internet dan tanpa menyimpan ulang berkas gambar.
 *
 * Aman diulang: hanya menyentuh baris yang `image_url` masih kosong, dan hanya memakai hak yang
 * sudah dinyatakan (permission_confirmed). Tidak ada tombol baru — ini bagian dari putaran biasa.
 */
export async function repairArticleImages(db: import('@libsql/client').Client, opts: {
  fetcher?: typeof fetch; env?: NodeJS.ProcessEnv; max?: number;
} = {}) {
  const env = opts.env ?? process.env;
  const target = resolveDeliveryTarget(env);
  const out = {checked: 0, missing: 0, repaired: 0};
  if (!target.url || !target.key) return out;
  const max = opts.max ?? 15;
  const rows = (await db.execute({sql: "SELECT snapshot_json FROM hub_publish_outbox WHERE status='published' ORDER BY created_at DESC LIMIT 200", args: []})).rows;
  const wants = new Map<string, {image: string; credit: string}>();
  for (const row of rows) {
    let snap: Record<string, unknown>;
    try { snap = JSON.parse(String(row.snapshot_json)) as Record<string, unknown>; } catch { continue; }
    if (String(snap.sourceRights || '') !== 'permission_confirmed') continue;
    const image = typeof snap.sourceImageUrl === 'string' ? snap.sourceImageUrl : '';
    const url = typeof snap.originalUrl === 'string' ? snap.originalUrl : '';
    if (!/^https:\/\//i.test(image) || !/^https:\/\//i.test(url)) continue;
    if (!wants.has(url)) wants.set(url, {image, credit: String(snap.sourceName || 'Penerbit sumber')});
  }
  out.checked = wants.size;
  if (!wants.size) return out;
  const urls = [...wants.keys()].slice(0, 40);
  const fetcher = opts.fetcher ?? fetch;
  let origin: URL;
  try { origin = new URL(target.url); } catch { return out; }
  if (origin.protocol !== 'https:') return out;
  const headers = {apikey: target.key, Authorization: `Bearer ${target.key}`};
  const filter = urls.map(u => `"${u.replace(/"/g, '%22')}"`).join(',');
  let ids: {id: string; source_url: string}[] = [];
  try {
    const r = await fetcher(new URL(`/rest/v1/articles?select=id,source_url&image_url=is.null&source_url=in.(${filter})`, origin).href,
      {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers});
    if (!r.ok) { await r.body?.cancel().catch(() => {}); return out; }
    ids = JSON.parse(await r.text()) as {id: string; source_url: string}[] | [];
    if (!Array.isArray(ids)) ids = [];
  } catch { return out; }
  out.missing = ids.length;
  for (const row of ids.slice(0, max)) {
    const want = wants.get(String(row.source_url));
    if (!want) continue;
    try {
      const r = await fetcher(new URL(`/rest/v1/articles?id=eq.${encodeURIComponent(String(row.id))}`, origin).href,
        {method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: {...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal'},
          body: JSON.stringify({image_url: want.image, image_credit: want.credit})});
      if (r.ok) out.repaired += 1;
      else await r.body?.cancel().catch(() => {});
    } catch { /* satu baris gagal tidak menghentikan sisanya */ }
  }
  return out;
}
