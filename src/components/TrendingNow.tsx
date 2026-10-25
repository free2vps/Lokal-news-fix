import { PLATFORM_LABEL, type Trend } from '@/lib/types';

const dedupe = (arr: Trend[]) => {
  const seen = new Set<string>();
  return arr.filter((t) => { const k = t.title.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); });
};
const topics = (all: Trend[]) => all.filter((t) => t.kind === 'topic').sort((a, b) => a.rank - b.rank);

export const topicsOf = (all: Trend[]) => dedupe(topics(all));
/** Topik X (API resmi atau trends24); bila kosong, pakai semua topik agar panel tidak kosong. */
export const xTopics = (all: Trend[]) => { const x = dedupe(topics(all).filter((t) => t.platform === 'x' || t.platform === 'x_t24')); return x.length ? x : topicsOf(all); };
/** Topik Google untuk teks berjalan; bila kosong, pakai semua topik. */
export const googleTopics = (all: Trend[]) => { const g = dedupe(topics(all).filter((t) => t.platform === 'google')); return g.length ? g : topicsOf(all); };

/** Tautan keluar yang pasti berisi hasil: Google Berita untuk topik Google, pencarian X untuk topik X. */
export const trendHref = (t: Trend) =>
  t.platform === 'google' || !t.url ? `https://www.google.com/search?q=${encodeURIComponent(t.title)}&tbm=nws` : t.url;

export default function TrendingNow({ items }: { items: Trend[] }) {
  const list = xTopics(items).slice(0, 10);
  if (!list.length) return null;
  return (
    <section aria-labelledby="trend" className="rounded-2xl border border-line/70 bg-surface p-3">
      <h2 id="trend" className="flex items-center gap-2 px-1 pb-2 text-lg font-bold">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-pop" aria-hidden><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>Trending
      </h2>
      <ol>
        {list.map((t, i) => (
          <li key={t.id} className="border-t border-line/60 first:border-0">
            <a href={trendHref(t)} target="_blank" rel="noopener nofollow" className="flex items-start gap-3 rounded-lg px-1 py-2.5 hover:bg-line/40">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded bg-ink text-xs font-bold text-bg">{i + 1}</span>
              <span className="min-w-0">
                <span className="line-clamp-2 break-words text-sm font-semibold leading-snug">{t.title}</span>
                <span className="mt-0.5 block text-xs text-muted">{PLATFORM_LABEL[t.platform]}{t.metric ? `, ${t.metric}` : ''}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
