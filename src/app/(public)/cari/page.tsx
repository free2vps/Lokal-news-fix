import type { Metadata } from 'next';
import { searchArticles } from '@/lib/queries';
import NewsCard from '@/components/NewsCard';
import SearchForm from '@/components/SearchForm';

export const metadata: Metadata = { title: 'Cari berita', robots: { index: false } };

export default async function Cari({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q || '').trim().slice(0, 80);
  const items = q ? await searchArticles(q) : [];
  return (
    <>
      <div className="mb-6 max-w-lg"><SearchForm defaultValue={q} /></div>
      {q && <h1 className="mb-4 font-serif text-2xl font-semibold">{items.length} hasil untuk “{q}”</h1>}
      {q && !items.length && <p className="text-muted">Belum ada berita kami tentang topik ini. Coba kata kunci lain atau cek kategori di atas.</p>}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((a) => <NewsCard key={a.id} a={a} />)}</div>
    </>
  );
}
