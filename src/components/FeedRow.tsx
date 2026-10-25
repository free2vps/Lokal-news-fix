import Link from 'next/link';
import type { Article } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

/** Baris feed ala portal: gambar landscape 16:9 di kiri, hanya label, judul, dan sumber (tanpa ringkasan). */
export default function FeedRow({ a }: { a: Article }) {
  const fun = a.section === 'hiburan';
  return (
    <article className="flex gap-4 border-b border-line/70 py-4 first:pt-0 last:border-0">
      <Link href={`/berita/${a.slug}`} tabIndex={-1} aria-hidden className="relative block aspect-video w-36 shrink-0 self-start overflow-hidden rounded-xl bg-line/50 sm:w-60">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.image_url ? <img src={a.image_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover object-[50%_30%]" />
          : <div className="grid h-full place-items-center bg-brand/10 font-serif text-3xl text-brand/40">{a.category[0]}</div>}
      </Link>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold ${fun ? 'text-pop' : 'text-brand'}`}>{a.category}</p>
        <h3 className="mt-1 line-clamp-3 text-base font-bold leading-snug sm:text-xl"><Link href={`/berita/${a.slug}`} className="hover:text-brand">{a.title}</Link></h3>
        <p className="mt-2 text-xs text-muted">{a.source_name}<span aria-hidden className="mx-1.5">/</span>{timeAgo(a.published_at)}</p>
      </div>
    </article>
  );
}
