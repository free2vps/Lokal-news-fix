import { createHash } from 'crypto';
import { detectRegion } from '@/config/regions';
import { slugify, refineCategory, NEWS_CATEGORIES, FUN_CATEGORIES } from '../utils';
import type { Trend } from '../types';

type RecordValue = Record<string, unknown>;
export function object(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}
export const text = (value: unknown) => typeof value === 'string' ? value : '';
export function safeUrl(value: unknown): string | null {
  try { const url = new URL(text(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function keywords(value: unknown): string[] {
  try { return array(typeof value === 'string' ? JSON.parse(value) : value).filter((v): v is string => typeof v === 'string').slice(0, 8); } catch { return []; }
}
function category(input: string, section: string, full: string, region: string | null) {
  if (section === 'hiburan') {
    if (FUN_CATEGORIES.includes(input)) return input;
    if (/musik|film|movie|hiburan/i.test(input)) return 'Film & Musik';
    if (/seleb|showbiz/i.test(input)) return 'Selebriti';
    if (/kuliner|wisata|food|travel/i.test(input)) return 'Kuliner & Wisata';
    if (/game|tren|viral/i.test(input)) return 'Viral & Trending';
    return 'Gaya Hidup';
  }
  const base = NEWS_CATEGORIES.includes(input) ? input : /karier/i.test(input) ? 'Lowongan & CPNS' : /ekonomi|bisnis/i.test(input) ? 'Ekonomi' : /pemerintahan/i.test(input) ? 'Info Pemda' : /pemuda|komunitas|humaniora/i.test(input) ? 'Sosial & Budaya' : 'Umum';
  return refineCategory(full, base, region);
}
export function mapHubArticle(value: unknown, now = Date.now()) {
  const item = object(value);
  if (!item || item.kind !== 'article' || !text(item.title) || !['news', 'entertainment'].includes(text(item.contentGroup))) return null;
  const url = safeUrl(item.original_url);
  const date = Date.parse(text(item.published_at));
  if (!url || !Number.isFinite(date) || date > now + 300000 || now - date > 72 * 3600000) return null;
  const title = text(item.title).slice(0, 500);
  const summary = text(item.summary).slice(0, 1000);
  const full = `${title} ${summary}`;
  const region = detectRegion(full);
  const section = item.contentGroup === 'entertainment' ? 'hiburan' : 'berita';
  return {
    slug: `${slugify(title).slice(0,70)}-hub-${createHash('sha256').update(url).digest('hex').slice(0,12)}`,
    source_url:url,source_name:text(item.source_name).slice(0,200)||'Penerbit sumber', original_title:title,title,
    // Legacy database column name, not a claim of AI authorship.
    ai_summary:summary,category:category(text(item.editorial_category),section,full,region),section,region,tags:keywords(item.keywords),
    image_url:safeUrl(item.image_url),image_credit:text(item.image_credit)||null,published_at:new Date(date).toISOString(),
    meta_title:title,meta_description:summary.slice(0,155),key_points:[],section_headings:[],
  };
}
export function mapHubTrends(xValue: unknown, youtubeValue: unknown, now=Date.now()): Trend[] {
  const x=object(xValue), rows: Trend[]=[];
  const snapshot=object(x?.lastValidSnapshot);
  const timestamp=text(x?.sourceSnapshotAt)||text(snapshot?.source_snapshot_at);
  const age=now-Date.parse(timestamp);
  const stale=!Number.isFinite(age)||age>3*3600000||x?.freshnessStatus==='STALE';
  const label=timestamp?new Date(timestamp).toLocaleString('id-ID',{timeZone:'Asia/Makassar'}):'waktu sumber tidak tersedia';
  array(x?.items).forEach((value,index)=>{const item=object(value);if(!item||!text(item.trendText))return;rows.push({id:-100000-index,platform:'x_t24',kind:'topic',rank:Number.isInteger(item.rank)&&Number(item.rank)>0?Number(item.rank):index+1,title:text(item.trendText),url:`https://x.com/search?q=${encodeURIComponent(text(item.trendText))}`,metric:`Trends24 · snapshot 1 hour ago · ${label} WITA${stale?' · data lama':''}`,image_url:null});});
  array(youtubeValue).filter(v=>object(v)?.is_music===1).forEach((value,index)=>{const item=object(value)!;const id=text(item.video_id);if(!/^[\w-]{11}$/.test(id)||!text(item.title))return;rows.push({id:-200000-index,platform:'yt_feed',kind:'video',rank:index+1,title:text(item.title),url:`https://www.youtube.com/watch?v=${id}`,metric:text(item.channel_title)||'Klasifikasi musik berbasis aturan',image_url:safeUrl(item.thumbnail_url)});});
  return rows;
}
