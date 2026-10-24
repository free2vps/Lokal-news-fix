import Link from 'next/link';
import { getLatest } from '@/lib/queries';
import { slugify, timeAgo } from '@/lib/utils';
import HeroCard from './HeroCard';

export default async function CategoryBlock({ category }: { category: string }) {
  const items = await getLatest({ limit: 4, category });
  if (items.length < 2) return null;
  const [lead, ...rest] = items;
  return (
    <section aria-label={category}>
      <div className="mb-3 flex items-end justify-between border-b-2 border-brand pb-1">
        <h2 className="font-serif text-xl font-semibold text-brand">{category}</h2>
        <Link href={`/kategori/${slugify(category)}`} className="text-sm text-muted hover:text-brand">Lihat semua</Link>
      </div>
      <HeroCard a={lead} size="sm" />
      <ul className="mt-3 divide-y divide-line">
        {rest.map((a) => (
          <li key={a.id} className="py-2.5">
            <Link href={`/berita/${a.slug}`} className="line-clamp-2 font-medium leading-snug hover:text-brand">{a.title}</Link>
            <span className="text-xs text-muted">{a.source_name}, {timeAgo(a.published_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
