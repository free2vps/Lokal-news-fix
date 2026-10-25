import { createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '../supabase';
import { slugify, refineCategory } from '../utils';
import { detectRegion } from '../../config/regions';
import { bestImage } from './image';
import type { Source } from '../types';
import { fetchRss } from './rss';
import { scrapeArticle, scrapeList, type RawItem } from './scraper';
import { summarize, chooseTitle } from './ai';

type Candidate = { url: string; raw?: RawItem };

// Lewati berita yang terlalu lama (mencegah feed lama ikut diproses sebagai "berita baru")
const maxAgeMs = Number(process.env.MAX_AGE_DAYS ?? 60) * 86400000;
const isFresh = (raw?: RawItem) => !raw?.publishedAt || isNaN(+new Date(raw.publishedAt)) || Date.now() - +new Date(raw.publishedAt) <= maxAgeMs;

async function collect(s: Source): Promise<Candidate[]> {
  if (s.type === 'rss') return (await fetchRss(s)).filter(isFresh).map((raw) => ({ url: raw.url, raw }));
  return (await scrapeList(s)).map((url) => ({ url }));
}

async function build(s: Source, c: Candidate) {
  let raw = c.raw;
  const page = await scrapeArticle(c.url, s.selectors).catch(() => null); // og:image halaman biasanya beresolusi lebih besar daripada RSS
  if (page) raw = raw ? { ...raw, text: raw.text.length >= page.text.length ? raw.text : page.text, publishedAt: raw.publishedAt || page.publishedAt } : page;
  if (!raw || raw.text.length < 80) throw new Error('teks sumber terlalu pendek');
  if (!isFresh(raw)) throw new Error('berita terlalu lama (melewati MAX_AGE_DAYS)');
  const [ai, img] = await Promise.all([summarize(raw, s.name, s.section), bestImage([page?.image, raw.image])]); // hanya ringkasan yang disimpan, bukan teks asli
  const full = `${raw.title}\n${raw.text}`;
  const region = detectRegion(full);
  const title = chooseTitle(ai.title, raw.title, raw.text);
  const date = raw.publishedAt ? new Date(raw.publishedAt) : new Date();
  const base = (slugify(ai.slugHint) || slugify(title)).slice(0, 70).replace(/-+$/, '');
  return {
    source_id: s.id, slug: `${base}-${createHash('md5').update(c.url).digest('hex').slice(0, 6)}`, source_url: c.url, source_name: s.name,
    original_title: raw.title, title, ai_summary: ai.summary, section_headings: ai.headings, key_points: ai.keyPoints,
    meta_title: ai.metaTitle, meta_description: ai.metaDescription, social_caption: ai.socialCaption || null,
    category: s.section === 'berita' ? refineCategory(full, ai.category, region) : ai.category, section: s.section, region, tags: ai.tags,
    image_url: img?.url ?? null, image_width: img?.width ?? null, image_height: img?.height ?? null, image_credit: img ? s.name : null,
    published_at: (isNaN(date.getTime()) ? new Date() : date).toISOString(),
  };
}

export async function runSync(opts: { sourceId?: number } = {}) {
  const db = supabaseAdmin();
  let q = db.from('sources').select('*').eq('active', true);
  if (opts.sourceId) q = q.eq('id', opts.sourceId);
  const { data: sources } = await q;
  const stats = { sources: 0, found: 0, inserted: 0, errors: [] as string[] };
  const total = Number(process.env.MAX_NEW_PER_RUN ?? 8);
  const newsShare = Math.min(1, Math.max(0, Number(process.env.NEWS_RATIO ?? 0.6)));
  const budgets: Record<string, number> = { berita: Math.ceil(total * newsShare), hiburan: Math.floor(total * (1 - newsShare)) };
  let aiDown = 0; // pemutus: berhenti jika AI gagal beruntun agar kuota tidak terbuang

  for (const s of (sources ?? []) as Source[]) {
    if (aiDown >= 2 || Object.values(budgets).every((b) => b <= 0)) break;
    if ((budgets[s.section] ?? 0) <= 0) continue;
    stats.sources++;
    try {
      const items = await collect(s);
      stats.found += items.length;
      const { data: existing } = await db.from('articles').select('source_url').in('source_url', items.map((i) => i.url));
      const seen = new Set((existing ?? []).map((e) => e.source_url));
      const fresh = items.filter((i) => !seen.has(i.url)).slice(0, budgets[s.section]);
      for (let i = 0; i < fresh.length; i += 3) {
        const chunkLen = fresh.slice(i, i + 3).length;
        const rows = (await Promise.all(fresh.slice(i, i + 3).map((c) =>
          build(s, c).catch((e) => { stats.errors.push(`${c.url}: ${e.message}`); return null; })))).filter(Boolean);
        if (!rows.length) {
          aiDown = stats.errors.slice(-chunkLen).every((e) => e.includes('AI gagal')) ? aiDown + 1 : 0;
          if (aiDown >= 2) { stats.errors.push('Dihentikan: AI tidak tersedia (cek API key/model/kuota)'); break; }
          continue;
        }
        aiDown = 0;
        const { error } = await db.from('articles').upsert(rows as object[], { onConflict: 'source_url', ignoreDuplicates: true });
        if (error) stats.errors.push(error.message); else { stats.inserted += rows.length; budgets[s.section] -= rows.length; }
      }
      await db.from('sources').update({ last_fetched_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) { stats.errors.push(`${s.name}: ${(e as Error).message}`); }
  }
  if (stats.inserted) { revalidatePath('/'); revalidatePath('/sitemap.xml'); }
  return stats;
}
