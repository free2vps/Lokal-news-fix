import { supabase } from './supabase';
import type { Article } from './types';

const LIST = 'id,slug,title,ai_summary,category,tags,image_url,image_credit,source_name,published_at,region,image_width,image_height,section';
const DETAIL = LIST + ',source_url,original_title,key_points,meta_title,meta_description,social_caption,section_headings';

export async function getLatest({ limit = 12, offset = 0, category, section }: { limit?: number; offset?: number; category?: string; section?: string }) {
  let q = supabase().from('articles').select(LIST).order('published_at', { ascending: false }).range(offset, offset + limit - 1);
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
  const { data } = await supabase().from('trending').select('id,platform,kind,rank,title,url,metric,image_url')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('rank');
  return (data ?? []) as Trend[];
}
