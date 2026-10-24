import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { http } from '../ingest/http';
import type { TrendRow } from '../types';

const compact = (n: number) => new Intl.NumberFormat('id-ID', { notation: 'compact' }).format(n);
const list = (v?: string) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const t24 = () => process.env.TRENDS24_ENABLED === '1'; // opt-in: pastikan Anda sudah memeriksa ketentuan trends24.in

/** Google Trends Indonesia (RSS publik, gratis). Jika Google mengubah URL-nya, sesuaikan di sini. */
export async function fetchGoogle(): Promise<TrendRow[]> {
  const parser = new Parser({ customFields: { item: [['ht:approx_traffic', 'traffic'], ['ht:picture', 'picture']] } });
  const feed = await parser.parseString(await http('https://trends.google.com/trending/rss?geo=ID'));
  return feed.items.slice(0, 15).map((i: any, n) => ({
    platform: 'google', kind: 'topic', rank: n + 1, title: String(i.title).trim(), url: i.link || null,
    metric: i.traffic ? `${i.traffic} pencarian` : null, image_url: i.picture || null,
  }));
}

/** X API resmi (berbayar per pemakaian). Dilewati jika X_BEARER_TOKEN kosong. */
export async function fetchX(): Promise<TrendRow[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];
  const woeid = process.env.X_WOEID || '23424846';
  const r = await fetch(`https://api.x.com/2/trends/by/woeid/${woeid}?max_trends=${process.env.X_MAX_TRENDS || 15}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!r.ok) throw new Error(`X API ${r.status}`);
  const j = await r.json();
  return (j.data ?? []).map((d: any, n: number) => ({
    platform: 'x', kind: 'topic', rank: n + 1, title: String(d.trend_name), url: `https://x.com/search?q=${encodeURIComponent(d.trend_name)}`,
    metric: d.tweet_count ? `${compact(Number(d.tweet_count))} postingan` : null, image_url: null,
  }));
}

/** Topik X Indonesia dari trends24.in (pengganti X API berbayar). Parser longgar: ambil tautan pencarian X/Twitter unik pertama. */
export async function fetchTrends24X(): Promise<TrendRow[]> {
  if (!t24()) return [];
  const $ = cheerio.load(await http('https://trends24.in/indonesia/'));
  const seen = new Set<string>();
  const rows: TrendRow[] = [];
  $('a[href*="twitter.com/search"], a[href*="x.com/search"]').each((_, a) => {
    const title = $(a).text().replace(/\s+/g, ' ').trim();
    if (!title || seen.has(title.toLowerCase()) || rows.length >= 20) return;
    seen.add(title.toLowerCase());
    const count = $(a).closest('li').find('.tweet-count').first().text().trim();
    rows.push({ platform: 'x_t24', kind: 'topic', rank: rows.length + 1, title, url: `https://x.com/search?q=${encodeURIComponent(title)}`, metric: count ? `${count} postingan` : null, image_url: null });
  });
  if (!rows.length) throw new Error('trends24: struktur halaman berubah, tidak ada topik terbaca');
  return rows;
}

/** oEmbed YouTube (tanpa API key). Video yang tidak boleh disematkan akan ditolak, jadi otomatis tersaring. */
async function oembed(id: string, rank: number, platform: 'yt_t24'): Promise<TrendRow | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { platform, kind: 'video', rank, title: String(j.title), url: `https://www.youtube.com/watch?v=${id}`, metric: j.author_name || null, image_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  } catch { return null; }
}

/** Video trending YouTube Indonesia dari youtube.trends24.in. */
export async function fetchTrends24YT(): Promise<TrendRow[]> {
  if (!t24()) return [];
  const $ = cheerio.load(await http('https://youtube.trends24.in/indonesia'));
  const ids: string[] = [];
  $('a[href*="watch?v="]').each((_, a) => {
    const m = ($(a).attr('href') || '').match(/watch\?v=([\w-]{11})/);
    if (m && !ids.includes(m[1]) && ids.length < 14) ids.push(m[1]);
  });
  const rows = (await Promise.all(ids.map((id, i) => oembed(id, i + 1, 'yt_t24')))).filter(Boolean) as TrendRow[];
  if (!rows.length) throw new Error('youtube.trends24: tidak ada video yang bisa dibaca/disematkan');
  return rows.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Video dari playlist/kanal pilihan Anda lewat RSS resmi YouTube (tanpa API key & tanpa kuota). */
export async function fetchYtFeeds(): Promise<TrendRow[]> {
  const qs = [...list(process.env.YOUTUBE_PLAYLIST_IDS).map((i) => `playlist_id=${i}`), ...list(process.env.YOUTUBE_CHANNEL_IDS).map((i) => `channel_id=${i}`)];
  if (!qs.length) return [];
  const parser = new Parser({ customFields: { item: [['yt:videoId', 'videoId']] } });
  const out: TrendRow[] = [];
  const errs: string[] = [];
  for (const q of qs) {
    try {
      const feed = await parser.parseString(await http(`https://www.youtube.com/feeds/videos.xml?${q}`));
      for (const it of feed.items.slice(0, 8) as any[]) {
        if (!it.videoId) continue;
        out.push({ platform: 'yt_feed', kind: 'video', rank: out.length + 1, title: String(it.title), url: `https://www.youtube.com/watch?v=${it.videoId}`, metric: it.author || feed.title || null, image_url: `https://i.ytimg.com/vi/${it.videoId}/hqdefault.jpg` });
      }
    } catch (e) { errs.push(`${q}: ${(e as Error).message}`); }
  }
  if (!out.length) throw new Error(errs[0] || 'feed kosong');
  return out.slice(0, 16);
}

/** YouTube Data API (opsional, butuh key): video populer Indonesia. */
export async function fetchYouTube(): Promise<TrendRow[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=ID&maxResults=8&key=${key}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!r.ok) throw new Error(`YouTube API ${r.status}`);
  const j = await r.json();
  return (j.items ?? []).map((v: any, n: number) => ({
    platform: 'youtube', kind: 'post', rank: n + 1, title: String(v.snippet.title), url: `https://www.youtube.com/watch?v=${v.id}`,
    metric: v.statistics?.viewCount ? `${compact(Number(v.statistics.viewCount))} tayangan` : null, image_url: v.snippet.thumbnails?.medium?.url || null,
  }));
}
