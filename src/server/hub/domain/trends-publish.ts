import type {Client} from '@libsql/client';
import {getX, getYoutube} from './social';
import {resolveDeliveryTarget} from './delivery-target';

/**
 * Kirim snapshot X Trending + YouTube milik Hub ke tabel `trending` di database portal.
 *
 * Kenapa perlu: beranda portal membaca `content_hub_cache` atau tabel `trending` di Supabase.
 * Endpoint impor lama (/api/portal-feed, /api/content-hub/push) sudah DINONAKTIFKAN, sehingga
 * tren yang berubah di Hub tidak pernah sampai ke portal. Jalur ini menulis langsung ke
 * `trending` memakai kredensial tujuan terbit yang sama seperti artikel.
 *
 * Tidak mengarang data: hanya snapshot sah yang ada di Hub. Baris diberi `expires_at` supaya
 * tren lama hilang sendiri dari beranda, dan id tetap supaya penulisan ulang menimpa baris yang sama.
 */
export type TrendRow = {
  id: string; platform: string; kind: string; rank: number;
  title: string; url: string | null; metric: string; image_url: string | null; expires_at: string;
};
export type TrendsPublishResult = {x: number; youtube: number; total: number; target: string};

const X_PLATFORM = 'x_t24';
const YT_PLATFORM = 'yt_feed';

export async function collectTrendRows(db: Client, master: string | undefined, now = Date.now()): Promise<TrendRow[]> {
  const [x, yt] = await Promise.all([
    getX(db, master).catch(() => null),
    getYoutube(db, master).catch(() => null),
  ]);
  const rows: TrendRow[] = [];
  const xExpiry = new Date(now + 6 * 3600000).toISOString();
  const ytExpiry = new Date(now + 24 * 3600000).toISOString();
  const items = Array.isArray((x as {items?: unknown})?.items) ? (x as {items: {text?: string; rank?: number}[]}).items : [];
  items.forEach((item, index) => {
    const title = String(item?.text || '').trim();
    if (!title) return;
    const rank = Number(item?.rank) > 0 ? Number(item.rank) : index + 1;
    const stamp = (x as {sourceSnapshotAt?: string | null})?.sourceSnapshotAt;
    rows.push({
      id: `hub-${X_PLATFORM}-${rank}`, platform: X_PLATFORM, kind: 'topic', rank,
      title: title.slice(0, 300),
      url: `https://x.com/search?q=${encodeURIComponent(title.slice(0, 120))}`,
      metric: `Trends24 · 1 hour ago${stamp ? ' · ' + new Date(stamp).toLocaleString('id-ID', {timeZone: 'Asia/Makassar'}) + ' WITA' : ''}`,
      image_url: null, expires_at: xExpiry,
    });
  });
  const videos = Array.isArray((yt as {items?: unknown})?.items) ? (yt as {items: {videoId?: string; title?: string; channel?: string}[]}).items : [];
  videos.forEach((video, index) => {
    const id = String(video?.videoId || '');
    const title = String(video?.title || '').trim();
    if (!/^[\w-]{11}$/.test(id) || !title) return;
    rows.push({
      id: `hub-${YT_PLATFORM}-${id}`, platform: YT_PLATFORM, kind: 'video', rank: index + 1,
      title: title.slice(0, 300), url: `https://www.youtube.com/watch?v=${id}`,
      metric: String(video?.channel || 'Playlist YouTube'),
      image_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, expires_at: ytExpiry,
    });
  });
  return rows;
}

export async function publishTrends(
  db: Client,
  opts: {master?: string; now?: number; fetcher?: typeof fetch; env?: NodeJS.ProcessEnv} = {},
): Promise<TrendsPublishResult> {
  const now = opts.now ?? Date.now();
  const env = opts.env ?? process.env;
  const target = resolveDeliveryTarget(env);
  if (target.source === 'none') throw Error('PUBLISH_TARGET_NOT_CONFIGURED');
  const rows = await collectTrendRows(db, opts.master, now);
  if (!rows.length) return {x: 0, youtube: 0, total: 0, target: 'supabase_trending'};
  const fetcher = opts.fetcher ?? fetch;
  const origin = new URL(target.url);
  if (origin.protocol !== 'https:') throw Error('PUBLISH_TARGET_INVALID');
  const r = await fetcher(new URL('/rest/v1/trending?on_conflict=id', origin).href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: {
      apikey: target.key, Authorization: `Bearer ${target.key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) { await r.body?.cancel().catch(() => {}); throw Error('TRENDS_HTTP_' + r.status); }
  return {
    x: rows.filter(row => row.platform === X_PLATFORM).length,
    youtube: rows.filter(row => row.platform === YT_PLATFORM).length,
    total: rows.length, target: 'supabase_trending',
  };
}
