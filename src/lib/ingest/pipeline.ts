import { createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '../supabase';
import { slugify } from '../utils';
import type { Source } from '../types';
import { fetchRss } from './rss';
import { scrapeArticle, scrapeList, type RawItem } from './scraper';
import { summarize } from './ai';

type Candidate = { url: string; raw?: RawItem };

async function collect(s: Source): Promise<Candidate[]> {
  if (s.type === 'rss') return (await fetchRss(s)).map((raw) => ({ url: raw.url, raw }));
  return (await scrapeList(s)).map((url) => ({ url }));
}

async function build(s: Source, c: Candidate) {
  let raw = c.raw;
  if (!raw || raw.text.length < 300 || !raw.image) {
    const page = await scrapeArticle(c.url, s.selectors).catch(() => null);
    if (page) raw = raw ? { ...raw, text: raw.text.length >= page.text.length ? raw.text : page.text, image: raw.image || page.image, publishedAt: raw.publishedAt || page.publishedAt } : page;
  }
  if (!raw || raw.text.length < 80) throw new Error('teks sumber terlalu pendek');
  const ai = await summarize(raw); // hanya hasil ringkasan yang disimpan, bukan teks asli
  const date = raw.publishedAt ? new Date(raw.publishedAt) : new Date();
  const slug = `${slugify(raw.title).slice(0, 80)}-${createHash('md5').update(c.url).digest('hex').slice(0, 6)}`;
  return {
    source_id: s.id, slug, source_url: c.url, source_name: s.name, original_title: raw.title, title: raw.title,
    ai_summary: ai.summary, key_points: ai.keyPoints, meta_title: ai.metaTitle, meta_description: ai.metaDescription,
    category: ai.category, tags: ai.tags, image_url: raw.image || null, image_credit: raw.image ? s.name : null,
    published_at: (isNaN(date.getTime()) ? new Date() : date).toISOString(),
  };
}

export async function runSync(opts: { sourceId?: number } = {}) {
  const db = supabaseAdmin();
  let q = db.from('sources').select('*').eq('active', true);
  if (opts.sourceId) q = q.eq('id', opts.sourceId);
  const { data: sources } = await q;
  const stats = { sources: 0, found: 0, inserted: 0, errors: [] as string[] };
  let budget = Number(process.env.MAX_NEW_PER_RUN ?? 8);

  for (const s of (sources ?? []) as Source[]) {
    if (budget <= 0) break;
    stats.sources++;
    try {
      const items = await collect(s);
      stats.found += items.length;
      const { data: existing } = await db.from('articles').select('source_url').in('source_url', items.map((i) => i.url));
      const seen = new Set((existing ?? []).map((e) => e.source_url));
      const fresh = items.filter((i) => !seen.has(i.url)).slice(0, budget);
      for (let i = 0; i < fresh.length; i += 3) {
        const rows = (await Promise.all(fresh.slice(i, i + 3).map((c) =>
          build(s, c).catch((e) => { stats.errors.push(`${c.url}: ${e.message}`); return null; })))).filter(Boolean);
        if (!rows.length) continue;
        const { error } = await db.from('articles').upsert(rows as object[], { onConflict: 'source_url', ignoreDuplicates: true });
        if (error) stats.errors.push(error.message); else { stats.inserted += rows.length; budget -= rows.length; }
      }
      await db.from('sources').update({ last_fetched_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) { stats.errors.push(`${s.name}: ${(e as Error).message}`); }
  }
  if (stats.inserted) { revalidatePath('/'); revalidatePath('/sitemap.xml'); }
  return stats;
}
