import Link from 'next/link';
import { regionName } from '@/config/regions';
import type { Article, Trend } from '@/lib/types';
import { trendHref } from './TrendingNow';

const card = 'flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-line/70 bg-surface p-3 hover:border-brand';
const label = 'text-xs text-muted';

export default function QuickCards({ topic, video, job, regions }: { topic?: Trend; video?: Trend; job?: Article; regions: string[] }) {
  const cards = [
    topic && (
      <a key="t" href={trendHref(topic)} target="_blank" rel="noopener nofollow" className={card}>
        <span className="min-w-0"><span className={label}>Topik terpanas</span><span className="line-clamp-2 block text-sm font-bold leading-snug">{topic.title}</span></span>
      </a>),
    video && (
      <Link key="v" href="/#video" className={card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {video.image_url && <img src={video.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-12 w-16 shrink-0 rounded-md object-cover" />}
        <span className="min-w-0"><span className={label}>Video untuk Anda</span><span className="line-clamp-2 block text-sm font-bold leading-snug">{video.title}</span></span>
      </Link>),
    job && (
      <Link key="j" href={`/berita/${job.slug}`} className={card}>
        <span className="min-w-0"><span className={label}>Lowongan terbaru</span><span className="line-clamp-2 block text-sm font-bold leading-snug">{job.title}</span></span>
      </Link>),
    regions.length > 0 && (
      <div key="r" className={card}>
        <span className="min-w-0"><span className={label}>Berita per wilayah</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm font-bold">
            {regions.slice(0, 3).map((r) => <Link key={r} href={`/wilayah/${r}`} className="text-brand hover:underline">{regionName(r) ?? r}</Link>)}
          </span></span>
      </div>),
  ].filter(Boolean);
  if (cards.length < 2) return null;
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards}</div>;
}
