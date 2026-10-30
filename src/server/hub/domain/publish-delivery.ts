import {mapHubArticle} from '@/lib/content-hub/mapping';
import type {Deliver, DeliveryResult} from './publish-policy';

/**
 * Adapter pengiriman ke tabel `articles` di situs (Supabase).
 * Kredensial HANYA dari environment backend dan sengaja memakai nama terpisah dari variabel
 * publik situs, sehingga patch ini tidak menyentuh Supabase website yang sudah berjalan.
 * Tanpa kredensial, tidak ada permintaan jaringan yang dibuat.
 */
export const DELIVERY_ENV = {url: 'HUB_WEBSITE_SUPABASE_URL', key: 'HUB_WEBSITE_SERVICE_ROLE_KEY'} as const;

export function articleRow(snapshot: Record<string, unknown>) {
  const title = String(snapshot.editorialTitle || snapshot.sourceTitle || '');
  const summary = String(snapshot.editorialSummary || snapshot.sourceSnippet || '');
  const category = String(snapshot.editorialCategory || '');
  const entertainment = /hiburan|film|musik|drakor|dracin|idol|seleb|game/i.test(category);
  return mapHubArticle({
    kind: 'article', title, summary, original_url: snapshot.originalUrl, published_at: snapshot.sourcePublishedAt,
    source_name: '', original_title: snapshot.sourceTitle, editorial_category: category,
    contentGroup: entertainment ? 'entertainment' : 'news',
  });
}

export function supabaseDeliver(fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Deliver {
  return async (items) => {
    const base = env[DELIVERY_ENV.url], key = env[DELIVERY_ENV.key];
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
