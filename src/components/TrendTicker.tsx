import type { Trend } from '@/lib/types';
import { googleTopics, trendHref } from './TrendingNow';

export default function TrendTicker({ items }: { items: Trend[] }) {
  const topics = googleTopics(items).slice(0, 14);
  if (!topics.length) return null;
  const row = (suffix: string) => topics.map((t) => (
    <a key={suffix + t.id} href={trendHref(t)} target="_blank" rel="noopener nofollow" className="mx-4 whitespace-nowrap hover:text-brand hover:underline">{t.title}</a>
  ));
  return (
    <div className="border-t border-line bg-surface/80">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-1.5 text-sm">
        <span className="shrink-0 rounded bg-pop px-2 py-0.5 text-xs font-semibold text-white">Trending</span>
        <div className="marquee-wrap min-w-0 flex-1 overflow-hidden" aria-label="Topik trending">
          <div className="marquee">{row('a')}<span aria-hidden className="flex">{row('b')}</span></div>
        </div>
      </div>
    </div>
  );
}
