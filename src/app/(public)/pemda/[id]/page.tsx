import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPemda, getPemdaList, getPemdaArticles } from '@/lib/queries';
import NewsCard from '@/components/NewsCard';

export const revalidate = 300;
export const dynamicParams = true;

/** Semua id diketahui dari database pemda — dipakai agar halaman masuk ISR (● saat build). */
export async function generateStaticParams() {
  const daftar = await getPemdaList().catch(() => []);
  return daftar.map((p) => ({ id: p.id }));
}

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const p = await getPemda(id);
  if (!p) return {};
  const items = await getPemdaArticles(id, 24).catch(() => []);
  return {
    title: `Berita ${p.nama_pendek}`,
    description: `Kumpulan berita ${p.nama} dari berbagai media lokal.`,
    alternates: { canonical: `/pemda/${id}` },
    // Sama seperti /topik/[tag]: halaman tipis (kurang dari 3 berita) tidak diindeks.
    robots: items.length < 3 ? { index: false, follow: true } : undefined,
  };
}

export default async function PemdaPage({ params }: P) {
  const { id } = await params;
  const p = await getPemda(id);
  if (!p) notFound();
  const items = await getPemdaArticles(id, 24);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `Berita ${p.nama_pendek}`,
      about: { '@type': 'GovernmentOrganization', name: p.nama },
      url: `/pemda/${id}`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Beranda', item: '/' },
        { '@type': 'ListItem', position: 2, name: 'Pemda NTB', item: '/pemda' },
        { '@type': 'ListItem', position: 3, name: p.nama_pendek, item: `/pemda/${id}` },
      ],
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="mb-3 text-xs text-muted">
        <Link href="/" className="hover:underline">Beranda</Link> {' › '}
        <Link href="/pemda" className="hover:underline">Pemda NTB</Link> {' › '}
        <span>{p.nama_pendek}</span>
      </nav>

      <h1 className="mb-1 border-l-4 border-accent pl-3 font-serif text-3xl font-semibold">
        Berita {p.nama_pendek}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {p.nama}
        {p.situs ? <> · <a href={p.situs} target="_blank" rel="noopener nofollow" className="underline">situs resmi</a></> : null}
      </p>

      {items.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => <NewsCard key={a.id} a={a} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-line/70 bg-surface p-6">
          <p className="font-semibold">Belum ada berita untuk daerah ini.</p>
          <p className="mt-2 text-sm text-muted">
            Portal hanya menampilkan berita yang benar-benar diliput media. Tidak ada berita
            yang dikarang untuk mengisi halaman kosong.
          </p>
        </div>
      )}
    </>
  );
}
