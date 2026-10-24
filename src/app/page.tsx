import Link from 'next/link';
import { getLatest, getTrending } from '@/lib/queries';
import { SITE } from '@/config/site';
import HeroCard from '@/components/HeroCard';
import RowCard from '@/components/RowCard';
import NewsCard from '@/components/NewsCard';
import TrendingNow from '@/components/TrendingNow';
import SocialHype from '@/components/SocialHype';
import VideoShelf from '@/components/VideoShelf';
import CategoryBlock from '@/components/CategoryBlock';
import LoadMore from '@/components/LoadMore';
import AdSlot from '@/components/AdSlot';
import JsonLd from '@/components/JsonLd';

export const revalidate = 300; // ISR 5 menit; sinkron trending memicu revalidate

const BLOCKS = ['Info Pemda', 'Peristiwa Daerah', 'Lowongan & CPNS', 'Event & Kebijakan Lokal'];
const Head = ({ id, pop, children }: { id: string; pop?: boolean; children: React.ReactNode }) => (
  <h2 id={id} className={`mb-3 border-b-2 pb-1 font-serif text-2xl font-semibold ${pop ? 'border-pop text-pop' : 'border-brand text-brand'}`}>{children}</h2>
);

export default async function Home() {
  const [news, fun, trending] = await Promise.all([getLatest({ limit: 15, section: 'berita' }), getLatest({ limit: 8, section: 'hiburan' }), getTrending()]);
  const base = news.length ? news : fun;
  if (!base.length) return <p className="py-20 text-center text-muted">Belum ada berita. Tambahkan sumber di /admin lalu klik “Sync sekarang”.</p>;
  const [lead, ...rest] = base;
  const duo = rest.slice(0, 2);
  const feed = rest.slice(2);
  const picks = trending.filter((t) => t.kind === 'video' && t.platform === 'yt_feed');
  const yt = trending.filter((t) => t.kind === 'video' && t.platform === 'yt_t24');
  const funList = news.length ? fun : [];

  return (
    <div className="space-y-12">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: base.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE.url}/berita/${a.slug}`, name: a.title })) }} />

      <div className="grid gap-6 lg:grid-cols-12">
        <section aria-label="Berita utama" className="space-y-4 lg:col-span-8">
          <HeroCard a={lead} />
          <div className="grid gap-4 sm:grid-cols-2">{duo.map((a) => <HeroCard key={a.id} a={a} size="sm" />)}</div>
        </section>
        <aside className="space-y-6 lg:col-span-4">
          <TrendingNow items={trending} />
          <SocialHype items={trending} />
          <div className="hidden lg:block"><AdSlot slot="sidebar" /></div>
        </aside>
      </div>

      <VideoShelf picks={picks} trending={yt} />

      <div className="grid gap-10 lg:grid-cols-12">
        <section aria-labelledby="terbaru" className="lg:col-span-7">
          <Head id="terbaru">Berita terbaru</Head>
          {feed.map((a) => <RowCard key={a.id} a={a} />)}
          <LoadMore start={news.length} section="berita" initialDone={news.length < 15} />
        </section>
        {funList.length > 0 && (
          <section aria-labelledby="hiburan" className="self-start lg:sticky lg:top-32 lg:col-span-5">
            <Head id="hiburan" pop>Hiburan &amp; viral</Head>
            <div className="grid gap-4 sm:grid-cols-2">{funList.slice(0, 4).map((a) => <HeroCard key={a.id} a={a} size="sm" />)}</div>
            <div className="mt-4 space-y-4">{funList.slice(4, 8).map((a) => <NewsCard key={a.id} a={a} variant="compact" />)}</div>
            <Link href="/hiburan" className="mt-4 inline-block text-sm font-semibold text-pop hover:underline">Lihat semua hiburan</Link>
          </section>
        )}
      </div>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">{BLOCKS.map((c) => <CategoryBlock key={c} category={c} />)}</div>
    </div>
  );
}
