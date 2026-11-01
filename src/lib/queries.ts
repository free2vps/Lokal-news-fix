import { cache as requestCache } from 'react';
import { unstable_cache } from 'next/cache';
import { object, array, safeUrl } from './content-hub/mapping';
import { supabase } from './supabase';
import type { Article } from './types';
import { hubEnabled, cachedHubTrends, readHubCache } from './content-hub/cache';
import { mergeFeed, needsLatestFill, mergeTrends } from './feed-merge';

/**
 * Tag cache — satu tempat. Dipanggil ulang oleh /api/revalidate setiap kali Hub selesai
 * mengirim artikel baru, sehingga berita baru tetap langsung tampil walau halaman di-cache.
 */
export const TAG_ARTICLES = 'hub-articles';
export const TAG_TRENDS = 'hub-trends';
export const TAG_REGIONS = 'hub-regions';
export const TAG_SITE = 'hub-site';

const LIST = 'source_url,id,slug,title,ai_summary,category,tags,image_url,image_credit,source_name,published_at,region,image_width,image_height,section';
const DETAIL = LIST + ',source_url,original_title,key_points,meta_title,meta_description,social_caption,section_headings';

// Reuse one persisted snapshot read per server render; avoid oversized PostgREST URLs.
const editorialSnapshot=unstable_cache(async():Promise<Article[]>=>{
 const snapshots=await readHubCache().catch(()=>({} as Awaited<ReturnType<typeof readHubCache>>));
 const payload=object(snapshots.recommended?.payload);
 const urls=array(payload?.items).filter(v=>object(v)?.kind==='article').map(v=>safeUrl(object(v)?.original_url)).filter((v):v is string=>!!v).slice(0,100);
 if(!urls.length)return [];
 const batches:string[][]=[];for(let i=0;i<urls.length;i+=10)batches.push(urls.slice(i,i+10));
 const results=await Promise.all(batches.map(batch=>supabase().from('articles').select(LIST).in('source_url',batch).gte('published_at',new Date(Date.now()-72*3600000).toISOString()).lte('published_at',new Date(Date.now()+300000).toISOString())));
 const order=new Map(urls.map((url,i)=>[url,i]));
 return results.flatMap(r=>(r.data??[]) as Article[]).sort((a,b)=>(order.get(a.source_url||'')??100)-(order.get(b.source_url||'')??100));
},['hub-editorial-snapshot'],{revalidate:120,tags:[TAG_ARTICLES]});
const editorialArticles=requestCache(()=>editorialSnapshot());

const latestPublishedCached = unstable_cache(async (limit:number, offset:number, category:string|null, section:string|null) => {
  let q = supabase().from('articles').select(LIST).order('published_at', { ascending: false }).range(offset, offset + limit - 1);
  if (category) q = q.eq('category', category);
  if (section) q = q.eq('section', section);
  const { data } = await q;
  return (data ?? []) as Article[];
}, ['latest-published'], { revalidate: 300, tags: [TAG_ARTICLES] });

async function latestPublished({limit=12,offset=0,category,section}:{limit?:number;offset?:number;category?:string;section?:string}){
  return latestPublishedCached(limit, offset, category ?? null, section ?? null);
}

export async function getLatest({ limit = 12, offset = 0, category, section }: { limit?: number; offset?: number; category?: string; section?: string }) {
  if(hubEnabled()){
    let rows=await editorialArticles();
    if(category)rows=rows.filter(a=>a.category===category);
    if(section)rows=rows.filter(a=>a.section===section);
    // Snapshot Hub bisa kosong/kedaluwarsa (mis. tidak ada item dalam 72 jam terakhir).
    // Isi sisa slot dari artikel yang benar-benar terbit di database situs, tanpa mengarang data.
    const need=Math.max(0,offset)+limit;
    const latest=needsLatestFill(rows,need)?await latestPublished({limit:need,category,section}).catch(()=>[]):[];
    return mergeFeed(rows,latest,limit,offset);
  }
  return latestPublished({limit,offset,category,section});
}
const bySlugCached = unstable_cache(async (slug: string) => {
  const { data } = await supabase().from('articles').select(DETAIL).eq('slug', slug).maybeSingle();
  return data as Article | null;
}, ['by-slug'], { revalidate: 900, tags: [TAG_ARTICLES] });
export async function getBySlug(slug: string) {
  return bySlugCached(slug);
}
export async function getRelated(a: Article, limit = 4) {
  const cond = a.region ? `region.eq."${a.region}",category.eq."${a.category}"` : `category.eq."${a.category}"`;
  const { data } = await supabase().from('articles').select(LIST).or(cond)
    .neq('id', a.id).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}
const byRegionCached = unstable_cache(async (region: string, limit: number) => {
  const { data } = await supabase().from('articles').select(LIST).eq('region', region).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}, ['by-region'], { revalidate: 300, tags: [TAG_ARTICLES, TAG_REGIONS] });
export async function getByRegion(region: string, limit = 36) {
  return byRegionCached(region, limit);
}
const byTagCached = unstable_cache(async (tag: string, limit: number) => {
  const { data } = await supabase().from('articles').select(LIST).contains('tags', [tag]).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}, ['by-tag'], { revalidate: 600, tags: [TAG_ARTICLES] });
export async function getByTag(tag: string, limit = 36) {
  return byTagCached(tag, limit);
}
export async function searchArticles(q: string, limit = 20) {
  const { data } = await supabase().from('articles').select(LIST)
    .textSearch('search', q, { type: 'plain', config: 'simple' }).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}
const sitemapRowsCached = unstable_cache(async () => {
  const { data } = await supabase().from('articles').select('slug,published_at,region,tags').order('published_at', { ascending: false }).limit(5000);
  return data ?? [];
}, ['sitemap-rows'], { revalidate: 600, tags: [TAG_ARTICLES, TAG_REGIONS] });
export async function getSitemapRows() {
  return sitemapRowsCached();
}

import type { Trend } from './types';
const trendingCached = unstable_cache(async (): Promise<Trend[]> => {
  // Sumber utama: tabel `trending` (ditulis langsung oleh Hub: platform x_t24 / yt_feed / google).
  // Cadangan: snapshot `content_hub_cache` — hanya dipakai bila umurnya masih segar (<= 6 jam).
  const [cached, rows] = await Promise.all([
    cachedHubTrends().catch(() => [] as Trend[]),
    supabase().from('trending').select('id,platform,kind,rank,title,url,metric,image_url')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('rank')
      .then(r => (r.data ?? []) as Trend[], () => [] as Trend[]),
  ]);
  // Baris tabel `trending` adalah data langsung (Hub menulis ke sana), sedangkan `cached` adalah
  // arsip snapshot lama. Karena itu yang langsung didahulukan; arsip hanya mengisi kekosongan.
  return mergeTrends(rows, cached);
}, ['trending'], { revalidate: 120, tags: [TAG_TRENDS] });
export async function getTrending(): Promise<Trend[]> {
  return trendingCached();
}

/** Halaman feed campuran: 6 berita + 4 hiburan per halaman (komposisi 60/40), diselang-seling. */
export async function getMixedPage(page: number, skip = { news: 0, fun: 0 }) {
  const [n, f] = await Promise.all([
    getLatest({ limit: 6, offset: skip.news + page * 6, section: 'berita' }),
    getLatest({ limit: 4, offset: skip.fun + page * 4, section: 'hiburan' }),
  ]);
  const out: Article[] = [];
  let i = 0, j = 0;
  for (const c of 'NNHNHNNHNH') {
    const a = c === 'N' ? (n[i] ? n[i++] : f[j++]) : (f[j] ? f[j++] : n[i++]);
    if (a) out.push(a);
  }
  while (i < n.length) out.push(n[i++]);
  while (j < f.length) out.push(f[j++]);
  return out;
}

const activeRegionsCached = unstable_cache(async () => {
  const { data } = await supabase().from('articles').select('region').not('region', 'is', null).order('published_at', { ascending: false }).limit(300);
  return [...new Set((data ?? []).map((r: { region: string }) => r.region))];
}, ['active-regions'], { revalidate: 600, tags: [TAG_ARTICLES, TAG_REGIONS] });
export async function getActiveRegions() {
  return activeRegionsCached();
}

/**
 * Media sosial portal — dibaca dari database Hub (diisi lewat panel), BUKAN dari env.
 * Env hilang saat pindah hosting; baris database ikut pindah. Bila database belum siap,
 * kembalikan daftar kosong supaya footer tetap tampil tanpa tombol rusak.
 */
const socialCached = unstable_cache(async (): Promise<{ key: string; label: string; url: string }[]> => {
  try {
    const { getHubDb } = await import('@/server/hub/db/client');
    const { readPublicSocial } = await import('@/server/hub/domain/site-settings');
    return await readPublicSocial(getHubDb());
  } catch {
    return [];
  }
}, ['site-social'], { revalidate: 600, tags: [TAG_SITE] });

export function getSocialLinks() {
  return socialCached();
}
