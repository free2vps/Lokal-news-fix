import Link from 'next/link';
import type { Article } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

export default function HeroCard({ a, size = 'lg' }: { a: Article; size?: 'lg' | 'sm' }) {
  return (
    <article className="group relative overflow-hidden rounded-xl bg-brand">
      <Link href={`/berita/${a.slug}`} className={`block ${size === 'lg' ? 'aspect-[16/10]' : 'aspect-[4/3]'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.image_url && <img src={a.image_url} alt="" loading={size === 'lg' ? 'eager' : 'lazy'} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 text-white md:p-5">
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-[#1b1405]">{a.category}</span>
          <h2 className={`mt-2 font-serif font-semibold leading-tight ${size === 'lg' ? 'text-2xl md:text-4xl' : 'line-clamp-3 text-lg'}`}>{a.title}</h2>
          <p className="mt-1.5 text-xs text-white/80">{a.source_name}, {timeAgo(a.published_at)}</p>
        </div>
      </Link>
    </article>
  );
}
