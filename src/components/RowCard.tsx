import Link from 'next/link';
import type { Article } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

export default function RowCard({ a }: { a: Article }) {
  return (
    <article className="flex gap-4 border-b border-line py-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-brand">{a.category}</p>
        <h3 className="mt-1 line-clamp-3 font-serif text-lg font-semibold leading-snug"><Link href={`/berita/${a.slug}`} className="hover:text-brand">{a.title}</Link></h3>
        <p className="mt-1 line-clamp-2 hidden text-sm text-muted sm:block">{a.ai_summary.split('\n\n')[0]}</p>
        <p className="mt-2 text-xs text-muted">{a.source_name}, {timeAgo(a.published_at)}</p>
      </div>
      <Link href={`/berita/${a.slug}`} className="block aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-md bg-line/50 sm:w-40" aria-hidden tabIndex={-1}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.image_url ? <img src={a.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center bg-brand/10 font-serif text-3xl text-brand/40">{a.category[0]}</div>}
      </Link>
    </article>
  );
}
