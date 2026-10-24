import { SITE } from '@/config/site';
import { regionName } from '@/config/regions';
import { supabaseAdmin } from './supabase';

const COLS = 'id,slug,title,ai_summary,social_caption,category,region,tags,image_url,image_width,source_name,published_at';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Row = { id: number; slug: string; title: string; ai_summary: string; social_caption: string | null; category: string; region: string | null; tags: string[]; image_url: string | null; source_name: string; published_at: string };

function firstSentences(text: string, n = 2) {
  const parts = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(' ').slice(0, 320);
}

export function buildPayload(a: Row) {
  const url = `${SITE.url}/berita/${a.slug}`;
  const region = regionName(a.region) ?? null;
  const summary = firstSentences(a.ai_summary);
  const hook = a.social_caption || firstSentences(a.ai_summary, 1);
  const tagList = [...(region ? [region] : []), ...(a.tags ?? []).slice(0, 2)];
  const hashtags = tagList.map((t) => '#' + t.replace(/[^\p{L}\d]/gu, '')).filter((t) => t.length > 1);
  const tagLine = hashtags.length ? `\n\n${hashtags.join(' ')}` : '';
  return {
    event: 'article.published',
    id: a.id, title: a.title, url, category: a.category, region, source_name: a.source_name, published_at: a.published_at,
    image_url: a.image_url,
    og_image_url: `${SITE.url}/api/og?t=${encodeURIComponent(a.title)}&s=${encodeURIComponent(a.source_name)}&n=${encodeURIComponent(SITE.name)}`,
    summary_short: summary, hook, hashtags,
    caption: {
      facebook: `${hook}\n\n${summary}${tagLine}`,                                   // tautan dipasang lewat kolom "link" modul Facebook
      telegram_html: `<b>${esc(a.title)}</b>\n\n${esc(hook)}\n\n${region ? `📍 ${esc(region)}\n` : ''}🔗 <a href="${url}">Baca selengkapnya</a>${tagLine}`,
      whatsapp: `*${a.title}*\n\n${hook}\n\n🔗 ${url}`,
    },
  };
}

/** Kirim satu berita ke platform otomatisasi. Idempotent: hanya sekali per berita. */
export async function dispatchArticle(id: number) {
  const hook = process.env.AUTOMATION_WEBHOOK_URL;
  if (!hook) return { skipped: 'AUTOMATION_WEBHOOK_URL belum diatur' };
  const db = supabaseAdmin();
  const { data: a } = await db.from('articles').update({ distributed_at: new Date().toISOString() })
    .eq('id', id).is('distributed_at', null).select(COLS).maybeSingle(); // "klaim" atomik mencegah kirim ganda
  if (!a) return { skipped: 'sudah pernah dikirim / tidak ditemukan' };
  try {
    const r = await fetch(hook, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': process.env.AUTOMATION_SECRET || '' },
      body: JSON.stringify(buildPayload(a as Row)),
    });
    if (!r.ok) throw new Error(`Automation HTTP ${r.status}`);
    return { sent: id };
  } catch (e) {
    await db.from('articles').update({ distributed_at: null }).eq('id', id); // gagal: coba lagi pada putaran berikutnya
    throw e;
  }
}

/** Antrean "tetes": kirim paling banyak `limit` berita terlama yang belum terkirim (24 jam terakhir). */
export async function distributeBatch(limit = 2) {
  if (limit <= 0 || !process.env.AUTOMATION_WEBHOOK_URL) return { sent: [] as number[], errors: [] as string[] };
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await supabaseAdmin().from('articles').select('id').is('distributed_at', null).gte('published_at', since)
    .order('published_at', { ascending: true }).limit(limit);
  const out = { sent: [] as number[], errors: [] as string[] };
  for (const { id } of data ?? []) {
    try { const r = await dispatchArticle(id); if ('sent' in r && r.sent) out.sent.push(r.sent); } catch (e) { out.errors.push(`#${id}: ${(e as Error).message}`); }
  }
  return out;
}
