import { cache as requestCache } from 'react';
import { object, array, safeUrl } from './content-hub/mapping';
import { supabase } from './supabase';
import type { Article } from './types';
import { hubEnabled, cachedHubTrends, readHubCache } from './content-hub/cache';

const LIST = 'source_url,id,slug,title,ai_summary,category,tags,image_url,image_credit,source_name,published_at,region,image_width,image_height,section';
const DETAIL = LIST + ',source_url,original_title,key_points,meta_title,meta_description,social_caption,section_headings';

// Reuse one persisted snapshot read per server render; avoid oversized PostgREST URLs.
const editorialArticles=requestCache(async():Promise<Article[]>=>{
 const snapshots=await readHubCache().catch(()=>({} as Awaited<ReturnType<typeof readHubCache>>));
 const payload=object(snapshots.recommended?.payload);
 const urls=array(payload?.items).filter(v=>object(v)?.kind==='article').map(v=>safeUrl(object(v)?.original_url)).filter((v):v is string=>!!v).slice(0,100);
 if(!urls.length)return [];
 const batches:string[][]=[];for(let i=0;i<urls.length;i+=10)batches.push(urls.slice(i,i+10));
 const results=await Promise.all(batches.map(batch=>supabase().from('articles').select(LIST).in('source_url',batch).gte('published_at',new Date(Date.now()-72*3600000).toISOString()).lte('published_at',new Date(Date.now()+300000).toISOString())));
 const order=new Map(urls.map((url,i)=>[url,i]));
 return results.flatMap(r=>(r.data??[]) as Article[]).sort((a,b)=>(order.get(a.source_url||'')??100)-(order.get(b.source_url||'')??100));
});

export async function getLatest({ limit = 12, offset = 0, category, section }: { limit?: number; offset?: number; category?: string; section?: string }) {
  if(hubEnabled()){
    let rows=await editorialArticles();
    if(category)rows=rows.filter(a=>a.category===category);
    if(section)rows=rows.filter(a=>a.section===section);
    return rows.slice(offset,offset+limit);
  }
  let q = supabase().from('articles').select(LIST).order('published_at', { ascending: false }).range(offset, offset + limit - 1);
  if (hubEnabled()) q = q.gte('published_at',new Date(Date.now()-72*3600000).toISOString()).lte('published_at',new Date(Date.now()+300000).toISOString());
  if (category) q = q.eq('category', category);
  if (section) q = q.eq('section', section);
  const { data } = await q;
  return (data ?? []) as Article[];
}
export async function getBySlug(slug: string) {
  const { data } = await supabase().from('articles').select(DETAIL).eq('slug', slug).maybeSingle();
  return data as Article | null;
}
export async function getRelated(a: Article, limit = 4) {
  const cond = a.region ? `region.eq."${a.region}",category.eq."${a.category}"` : `category.eq."${a.category}"`;
  const { data } = await supabase().from('articles').select(LIST).or(cond)
    .neq('id', a.id).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}
export async function getByRegion(region: string, limit = 36) {
  const { data } = await supabase().from('articles').select(LIST).eq('region', region).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}
export async function getByTag(tag: string, limit = 36) {
  const { data } = await supabase().from('articles').select(LIST).contains('tags', [tag]).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}
export async function searchArticles(q: string, limit = 20) {
  const { data } = await supabase().from('articles').select(LIST)
    .textSearch('search', q, { type: 'plain', config: 'simple' }).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}
export async function getSitemapRows() {
  const { data } = await supabase().from('articles').select('slug,published_at,region,tags').order('published_at', { ascending: false }).limit(5000);
  return data ?? [];
}

import type { Trend } from './types';
export async function getTrending(): Promise<Trend[]> {
  if (hubEnabled()) {
    const cached = await cachedHubTrends().catch(() => []);
    // Only manual posts may supplement Hub data; never silently substitute old auto sources.
    const { data } = await supabase().from('trending').select('id,platform,kind,rank,title,url,metric,image_url').eq('source','manual').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('rank');
    return [...cached, ...((data ?? []) as Trend[])];
  }
  const { data } = await supabase().from('trending').select('id,platform,kind,rank,title,url,metric,image_url')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('rank');
  return (data ?? []) as Trend[];
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

export async function getActiveRegions() {
  const { data } = await supabase().from('articles').select('region').not('region', 'is', null).order('published_at', { ascending: false }).limit(300);
  return [...new Set((data ?? []).map((r: { region: string }) => r.region))];
}
