import type { Metadata } from 'next';
import Link from 'next/link';
import { getPemdaList, getPemdaCounts } from '@/lib/queries';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Pemda NTB',
  description: 'Berita dari 11 pemerintah daerah di Nusa Tenggara Barat: provinsi, kabupaten, dan kota.',
  alternates: { canonical: '/pemda' },
};

const STATUS: Record<string, { label: string; kelas: string }> = {
  bisa: { label: 'situs terbuka', kelas: 'bg-green-600/10 text-green-700 dark:text-green-400' },
  diblokir: { label: 'situs memblokir', kelas: 'bg-amber-600/10 text-amber-700 dark:text-amber-400' },
  mati: { label: 'situs tidak menjawab', kelas: 'bg-red-600/10 text-red-700 dark:text-red-400' },
  belum: { label: 'belum diperiksa', kelas: 'bg-line/60 text-muted' },
};

export default async function PemdaIndex() {
  const [daftar, jumlah] = await Promise.all([getPemdaList(), getPemdaCounts()]);
  const total = Object.values(jumlah).reduce((a, b) => a + b, 0);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Pemda NTB',
    description: 'Berita dari 11 pemerintah daerah di Nusa Tenggara Barat.',
    hasPart: daftar.map((p) => ({ '@type': 'WebPage', name: p.nama, url: `/pemda/${p.id}` })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1 className="mb-2 border-l-4 border-accent pl-3 font-serif text-3xl font-semibold">Pemda NTB</h1>
      <p className="mb-6 text-muted">
        Berita dari {daftar.length} pemerintah daerah di Nusa Tenggara Barat.
        {total > 0 ? ` ${total} keterkaitan artikel tercatat.` : ''}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {daftar.map((p) => {
          const n = jumlah[p.id] ?? 0;
          const st = STATUS[p.status_akses] ?? STATUS.belum;
          return (
            <Link key={p.id} href={`/pemda/${p.id}`}
              className="rounded-2xl border border-line/70 bg-surface p-4 transition hover:border-brand/40">
              <div className="flex items-start justify-between gap-3">
                <span className="font-serif text-xl font-semibold">{p.nama_pendek}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${st.kelas}`}>{st.label}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{p.nama}</p>
              <p className="mt-2 text-sm">
                {n > 0 ? <><b>{n}</b> artikel</> : <span className="text-muted">belum ada berita</span>}
              </p>
            </Link>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-muted">
        Status situs diukur langsung dari server. Situs yang memblokir akses otomatis tidak
        ditembus — berita daerahnya tetap muncul di sini bila diliput media lokal.
      </p>
    </>
  );
}
