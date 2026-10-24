import Parser from 'rss-parser';
import { http } from '../ingest/http';
import type { TrendRow } from '../types';

const compact = (n: number) => new Intl.NumberFormat('id-ID', { notation: 'compact' }).format(n);

/** Google Trends Indonesia (RSS publik, gratis). Jika Google mengubah URL-nya, sesuaikan di sini. */
export async function fetchGoogle(): Promise<TrendRow[]> {
  const parser = new Parser({ customFields: { item: [['ht:approx_traffic', 'traffic'], ['ht:picture', 'picture']] } });
  const feed = await parser.parseString(await http('https://trends.google.com/trending/rss?geo=ID'));
  return feed.items.slice(0, 15).map((i: any, n) => ({
    platform: 'google', kind: 'topic', rank: n + 1, title: String(i.title).trim(), url: i.link || null,
    metric: i.traffic ? `${i.traffic} pencarian` : null, image_url: i.picture || null,
  }));
}

/** X API resmi (berbayar per pemakaian). Dilewati jika X_BEARER_TOKEN kosong. Cek endpoint & harga di Developer Console. */
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

/** Video populer YouTube Indonesia (YouTube Data API v3, gratis dengan kuota). */
export async function fetchYouTube(): Promise<TrendRow[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=ID&maxResults=8&key=${key}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!r.ok) throw new Error(`YouTube API ${r.status}`);
  const j = await r.json();
  return (j.items ?? []).map((v: any, n: number) => ({
    platform: 'youtube', kind: 'post', rank: n + 1, title: String(v.snippet.title), url: `https://www.youtube.com/watch?v=${v.id}`,
    metric: v.statistics?.viewCount ? `${compact(Number(v.statistics.viewCount))} tayangan` : null,
    image_url: v.snippet.thumbnails?.medium?.url || null,
  }));
}
