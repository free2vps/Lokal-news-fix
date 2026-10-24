import { supabase } from './supabase';
import type { Article } from './types';

const LIST = 'id,slug,title,ai_summary,category,tags,image_url,image_credit,source_name,published_at';
const DETAIL = LIST + ',source_url,original_title,key_points,meta_title,meta_description';

export async function getLatest({ limit = 12, offset = 0, category }: { limit?: number; offset?: number; category?: string }) {
  let q = supabase().from('articles').select(LIST).order('published_at', { ascending: false }).range(offset, offset + limit - 1);
  if (category) q = q.eq('category', category);
  const { data } = await q;
  return (data ?? []) as Article[];
}
export async function getBySlug(slug: string) {
  const { data } = await supabase().from('articles').select(DETAIL).eq('slug', slug).maybeSingle();
  return data as Article | null;
}
export async function getRelated(a: Article, limit = 4) {
  const { data } = await supabase().from('articles').select(LIST).eq('category', a.category)
    .neq('id', a.id).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}
export async function searchArticles(q: string, limit = 20) {
  const { data } = await supabase().from('articles').select(LIST)
    .textSearch('search', q, { type: 'plain', config: 'simple' }).order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Article[];
}
export async function getSitemapRows() {
  const { data } = await supabase().from('articles').select('slug,published_at').order('published_at', { ascending: false }).limit(5000);
  return data ?? [];
}

import type { Trend } from './types';
export async function getTrending(): Promise<Trend[]> {
  const { data } = await supabase().from('trending').select('id,platform,kind,rank,title,url,metric,image_url')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('rank');
  return (data ?? []) as Trend[];
}
