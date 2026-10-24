import Link from 'next/link';
import { PLATFORM_LABEL, type Trend } from '@/lib/types';

export function topicsOf(all: Trend[]) {
  const seen = new Set<string>();
  return all.filter((t) => t.kind === 'topic').sort((a, b) => a.rank - b.rank)
    .filter((t) => { const k = t.title.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); });
}

export default function TrendingNow({ items }: { items: Trend[] }) {
  const topics = topicsOf(items).slice(0, 10);
  if (!topics.length) return null;
  return (
    <section aria-labelledby="trend" className="rounded-xl border border-line bg-surface p-4">
      <h2 id="trend" className="mb-2 flex items-center gap-2 font-serif text-xl font-semibold">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />Trending sekarang
      </h2>
      <ol className="divide-y divide-line">
        {topics.map((t, i) => (
          <li key={t.id}>
            <Link href={`/cari?q=${encodeURIComponent(t.title)}`} className="flex items-baseline gap-3 py-2.5 hover:text-brand">
              <span className="w-5 shrink-0 text-right font-serif text-lg font-bold text-accent">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.title}</span>
                <span className="text-xs text-muted">{PLATFORM_LABEL[t.platform]}{t.metric ? `, ${t.metric}` : ''}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
