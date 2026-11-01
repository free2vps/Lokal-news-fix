import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getByTag } from '@/lib/queries';
import NewsCard from '@/components/NewsCard';

export const revalidate = 600;
export const dynamicParams = true;
/** Hanya tag yang muncul di >=3 artikel yang dirender; tag sampah dibuang (lihat lib/quality). */
export async function generateStaticParams() {
  try {
    const { getSitemapRows } = await import('@/lib/queries');
    const { isMeaningfulTag } = await import('@/lib/quality');
    const rows = (await getSitemapRows()) as { tags: string[] | null }[];
    const count = new Map<string, number>();
    for (const r of rows) for (const t of r.tags ?? []) if (isMeaningfulTag(t)) count.set(t, (count.get(t) || 0) + 1);
    return [...count.entries()].filter(([, n]) => n >= 3).slice(0, 120).map(([tag]) => ({ tag }));
  } catch { return []; }
}
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
  // B4: halaman dengan <3 artikel tidak diterbitkan sama sekali (dulu hanya noindex, tetap 200).
  if (items.length < 3) notFound();
  return (
    <>
      <h1 className="mb-5 border-l-4 border-accent pl-3 font-serif text-3xl font-semibold">Topik: {tag}</h1>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((a) => <NewsCard key={a.id} a={a} />)}</div>
    </>
  );
}
