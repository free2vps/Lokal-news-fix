import type { Metadata } from 'next';
import Link from 'next/link';
import { getLatest } from '@/lib/queries';
import { FUN_CATEGORIES, slugify } from '@/lib/utils';
import HeroCard from '@/components/HeroCard';
import LoadMore from '@/components/LoadMore';

export const revalidate = 300;
export const metadata: Metadata = { title: 'Hiburan & Viral', description: 'Kabar selebriti, film, musik, gaya hidup, dan topik viral terbaru.', alternates: { canonical: '/hiburan' } };

export default async function Hiburan() {
  const items = await getLatest({ limit: 13, section: 'hiburan' });
  const [lead, ...rest] = items;
  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pop">Hiburan &amp; Viral</h1>
      <ul className="my-4 flex flex-wrap gap-2 text-sm">
        {FUN_CATEGORIES.map((c) => <li key={c}><Link href={`/kategori/${slugify(c)}`} className="rounded-full border border-line px-3 py-1 text-muted hover:border-pop hover:text-pop">{c}</Link></li>)}
      </ul>
      {lead ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><HeroCard a={lead} /></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">{rest.slice(0, 2).map((a) => <HeroCard key={a.id} a={a} size="sm" />)}</div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rest.slice(2).map((a) => <HeroCard key={a.id} a={a} size="sm" />)}</div>
          <LoadMore start={items.length} section="hiburan" initialDone={items.length < 13} />
        </>
      ) : <p className="text-muted">Belum ada konten hiburan. Tambahkan sumber bagian “Hiburan” di /admin.</p>}
    </>
  );
}
