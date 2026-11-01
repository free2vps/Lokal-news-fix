import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLatest } from '@/lib/queries';
import { categoryFromSlug } from '@/lib/utils';
import NewsCard from '@/components/NewsCard';
import LoadMore from '@/components/LoadMore';

export const revalidate = 300;
type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const cat = categoryFromSlug((await params).slug);
  return cat ? { title: `Berita ${cat}`, description: `Kumpulan berita ${cat} terbaru.`, alternates: { canonical: `/kategori/${(await params).slug}` } } : {};
}

export default async function Kategori({ params }: P) {
  const cat = categoryFromSlug((await params).slug);
  if (!cat) notFound();
  const items = await getLatest({ limit: 12, category: cat });
  return (
    <>
      <h1 className="mb-5 border-l-4 border-accent pl-3 font-serif text-3xl font-semibold">{cat}</h1>
      {items.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((a) => <NewsCard key={a.id} a={a} />)}</div> : <p className="text-muted">Belum ada berita di kategori ini.</p>}
      {items.length > 0 && <LoadMore start={12} category={cat} initialDone={items.length < 12} />}
    </>
  );
}
