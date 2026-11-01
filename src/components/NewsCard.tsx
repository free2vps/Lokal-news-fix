import Link from 'next/link';
import type { Article } from '@/lib/types';
import { slugify, timeAgo } from '@/lib/utils';

const Thumb = ({ a }: { a: Article }) => a.image_url
  // eslint-disable-next-line @next/next/no-img-element
  ? <img src={a.image_url} alt={a.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" width={a.image_width||800} height={a.image_height||450} className="h-full w-full object-cover" />
  : <div className="grid h-full w-full place-items-center bg-brand/10 font-serif text-4xl text-brand/40" aria-hidden>{a.category[0]}</div>;

const Badge = ({ c }: { c: string }) => (
  <Link href={`/kategori/${slugify(c)}`} className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-bg">{c}</Link>
);

export default function NewsCard({ a, variant = 'default' }: { a: Article; variant?: 'default' | 'lead' | 'compact' }) {
  const href = `/berita/${a.slug}`;
  const lede = a.ai_summary.split('\n\n')[0];

  if (variant === 'compact') {
    return (
      <article className="flex gap-3">
        <Link href={href} className="block h-20 w-28 shrink-0 overflow-hidden rounded-md bg-line/50"><Thumb a={a} /></Link>
        <div className="min-w-0">
          <h3 className="line-clamp-3 font-serif text-base font-semibold leading-snug"><Link href={href} className="hover:text-brand">{a.title}</Link></h3>
          <p className="mt-1 text-xs text-muted">{a.source_name}, {timeAgo(a.published_at)}</p>
        </div>
      </article>
    );
  }
  if (variant === 'lead') {
    return (
      <article className="overflow-hidden rounded-xl border border-line bg-surface">
        <Link href={href} className="relative block aspect-[16/9] bg-line/50"><Thumb a={a} /></Link>
        <div className="space-y-3 p-5">
          <Badge c={a.category} />
          <h2 className="font-serif text-2xl font-semibold leading-tight md:text-3xl"><Link href={href} className="hover:text-brand">{a.title}</Link></h2>
          <p className="line-clamp-3 text-muted">{lede}</p>
          <p className="text-xs text-muted">Sumber: {a.source_name}, {timeAgo(a.published_at)}</p>
        </div>
      </article>
    );
  }
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <Link href={href} className="relative block aspect-[16/9] bg-line/50">
        <Thumb a={a} />
        <span className="absolute left-3 top-3 rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-white">{a.category}</span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-3 font-serif text-lg font-semibold leading-snug"><Link href={href} className="hover:text-brand">{a.title}</Link></h3>
        <p className="line-clamp-2 text-sm text-muted">{lede}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-muted">
          <span className="truncate">Sumber: {a.source_name}</span><time dateTime={a.published_at} className="shrink-0">{timeAgo(a.published_at)}</time>
        </div>
      </div>
    </article>
  );
}
