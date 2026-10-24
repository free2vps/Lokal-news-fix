import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { REGIONS } from '@/config/regions';
import { getByRegion } from '@/lib/queries';
import NewsCard from '@/components/NewsCard';

export const revalidate = 600;
type P = { params: Promise<{ slug: string }> };
const load = cache(getByRegion);

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const r = REGIONS.find((x) => x.slug === slug);
  if (!r) return {};
  const items = await load(slug);
  return {
    title: `Berita ${r.name} Terbaru Hari Ini`,
    description: `Berita terbaru seputar ${r.name}: info pemda, peristiwa daerah, lowongan, dan kebijakan lokal, diperbarui setiap jam.`,
    alternates: { canonical: `/wilayah/${slug}` },
    robots: items.length ? { index: true, follow: true, 'max-image-preview': 'large' } : { index: false, follow: true },
  };
}

export default async function Wilayah({ params }: P) {
  const { slug } = await params;
  const r = REGIONS.find((x) => x.slug === slug);
  if (!r) notFound();
  const items = await load(slug);
  return (
    <>
      <h1 className="font-serif text-3xl font-semibold">Berita {r.name} Terbaru</h1>
      <p className="mb-6 mt-2 max-w-2xl text-muted">Ringkasan berita terkini seputar {r.name} dari media dan situs resmi, lengkap dengan tautan ke artikel aslinya.</p>
      {items.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((a) => <NewsCard key={a.id} a={a} />)}</div> : <p className="text-muted">Belum ada berita untuk wilayah ini.</p>}
    </>
  );
}
