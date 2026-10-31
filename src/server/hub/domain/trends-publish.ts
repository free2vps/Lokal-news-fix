import type {Client} from '@libsql/client';
import {getX, getYoutube} from './social';
import {resolveDeliveryTarget} from './delivery-target';

/**
 * Kirim snapshot X Trending + YouTube milik Hub ke tabel `trending` di database portal.
 *
 * Kenapa perlu: beranda portal membaca `content_hub_cache` atau tabel `trending` di Supabase.
 * Endpoint impor lama (/api/portal-feed, /api/content-hub/push) sudah DINONAKTIFKAN, sehingga
 * tren yang berubah di Hub tidak pernah sampai ke portal.
 *
 * PENTING (perbaikan r16) — sebab `TRENDS_HTTP_400`:
 * kolom `trending.id` di portal adalah `GENERATED ALWAYS AS IDENTITY` (tanpa nilai bawaan).
 * Versi lama ikut mengirim `id: 'hub-x_t24-1'`, dan PostgreSQL menolak nilai eksplisit untuk
 * kolom identitas (galat 428C9) → PostgREST membalas 400. Sekarang `id` TIDAK dikirim sama
 * sekali; baris lama dibersihkan setelah baris baru masuk, memakai id yang dikembalikan server.
 *
 * Tidak mengarang data: hanya snapshot sah yang ada di Hub. `expires_at` membuat tren basi
 * hilang sendiri dari beranda.
 */
export type TrendRow = {
  platform: string; kind: string; rank: number; source: string;
  title: string; url: string | null; metric: string; image_url: string | null; expires_at: string;
};
export type TrendsPublishResult = {x: number; youtube: number; total: number; target: string; removed: number};

const X_PLATFORM = 'x_t24';
const YT_PLATFORM = 'yt_feed';
const TREND_SOURCE = 'hub';

/** Pesan galat pendek yang bisa dibaca pengguna; isi badan respons ikut dibawa agar sebabnya jelas. */
function httpCode(status: number, body: string) {
  const clean = body.replace(/\s+/g, ' ').trim().slice(0, 160);
  return `TRENDS_HTTP_${status}${clean ? ' — ' + clean : ''}`;
}

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
      platform: X_PLATFORM, kind: 'topic', rank, source: TREND_SOURCE,
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
      platform: YT_PLATFORM, kind: 'video', rank: index + 1, source: TREND_SOURCE,
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
  if (!rows.length) return {x: 0, youtube: 0, total: 0, target: 'supabase_trending', removed: 0};
  const fetcher = opts.fetcher ?? fetch;
  const origin = new URL(target.url);
  if (origin.protocol !== 'https:') throw Error('PUBLISH_TARGET_INVALID');
  const base = {apikey: target.key, Authorization: `Bearer ${target.key}`};

  // 1. Masukkan baris baru. `return=representation` memberi tahu id yang dipakai server.
  const r = await fetcher(new URL('/rest/v1/trending', origin).href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: {...base, 'Content-Type': 'application/json', Prefer: 'return=representation'},
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw Error(httpCode(r.status, body));
  }
  let inserted: {id: number | string}[] = [];
  try {
    const parsed = JSON.parse(await r.text()) as {id: number | string}[] | null;
    if (Array.isArray(parsed)) inserted = parsed;
  } catch { inserted = []; }

  // 2. Buang baris Hub yang lama (id tidak termasuk yang baru masuk). Bila server tidak
  //    mengembalikan id, baris lama dibiarkan: duplikat lebih ringan daripada data hilang,
  //    dan `expires_at` tetap menghapusnya dari beranda.
  let removed = 0;
  const ids = inserted.map(i => String(i.id)).filter(id => /^\d+$/.test(id));
  if (ids.length) {
    const q = `/rest/v1/trending?source=eq.${TREND_SOURCE}&id=not.in.(${ids.join(',')})`;
    try {
      const d = await fetcher(new URL(q, origin).href, {
        method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: {...base, Prefer: 'return=representation'},
      });
      if (d.ok) {
        try { const gone = JSON.parse(await d.text()) as unknown[]; removed = Array.isArray(gone) ? gone.length : 0; } catch { removed = 0; }
      } else await d.body?.cancel().catch(() => {});
    } catch { /* pembersihan opsional; tren baru sudah masuk */ }
  }

  return {
    x: rows.filter(row => row.platform === X_PLATFORM).length,
    youtube: rows.filter(row => row.platform === YT_PLATFORM).length,
    total: rows.length, target: 'supabase_trending', removed,
  };
}
