import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getByTag } from '@/lib/queries';
import NewsCard from '@/components/NewsCard';

export const revalidate = 600;
type P = { params: Promise<{ tag: string }> };
const load = cache(getByTag);
const decode = (t: string) => decodeURIComponent(t).toLowerCase().slice(0, 60);

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const tag = decode((await params).tag);
  const items = await load(tag);
  return {
    title: `Berita ${tag}`, description: `Kumpulan berita terbaru tentang ${tag}.`,
    alternates: { canonical: `/topik/${encodeURIComponent(tag)}` },
    robots: items.length >= 3 ? { index: true, follow: true, 'max-image-preview': 'large' } : { index: false, follow: true }, // halaman tipis tidak diindeks
  };
}

export default async function Topik({ params }: P) {
  const tag = decode((await params).tag);
  const items = await load(tag);
  if (!items.length) notFound();
  return (
    <>
      <h1 className="mb-5 border-l-4 border-accent pl-3 font-serif text-3xl font-semibold">Topik: {tag}</h1>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((a) => <NewsCard key={a.id} a={a} />)}</div>
    </>
  );
}
