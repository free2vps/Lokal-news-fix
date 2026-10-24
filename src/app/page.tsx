import { getLatest, getTrending } from '@/lib/queries';
import { SITE } from '@/config/site';
import HeroCard from '@/components/HeroCard';
import RowCard from '@/components/RowCard';
import TrendingNow from '@/components/TrendingNow';
import SocialHype from '@/components/SocialHype';
import CategoryBlock from '@/components/CategoryBlock';
import LoadMore from '@/components/LoadMore';
import AdSlot from '@/components/AdSlot';
import JsonLd from '@/components/JsonLd';

export const revalidate = 300; // ISR 5 menit; trending memicu revalidate saat diperbarui

const BLOCKS = ['Pemerintahan', 'Ekonomi', 'Olahraga', 'Hukum & Kriminal'];

export default async function Home() {
  const [all, trending] = await Promise.all([getLatest({ limit: 17 }), getTrending()]);
  if (!all.length) return <p className="py-20 text-center text-muted">Belum ada berita. Tambahkan sumber di /admin lalu klik “Sync sekarang”.</p>;
  const [lead, ...rest] = all;
  const mids = rest.slice(0, 4);
  const feed = rest.slice(4);

  return (
    <div className="space-y-10">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: all.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE.url}/berita/${a.slug}`, name: a.title })) }} />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="order-2 space-y-6 lg:order-1 lg:col-span-3"><TrendingNow items={trending} /></div>
        <section aria-label="Berita utama" className="order-1 space-y-4 lg:order-2 lg:col-span-6">
          <HeroCard a={lead} />
          <div className="grid grid-cols-2 gap-4">{mids.map((a) => <HeroCard key={a.id} a={a} size="sm" />)}</div>
        </section>
        <aside className="order-3 space-y-6 lg:col-span-3">
          <SocialHype items={trending} />
          <div className="hidden lg:block"><AdSlot slot="sidebar" /></div>
        </aside>
      </div>

      <section aria-labelledby="terbaru">
        <h2 id="terbaru" className="mb-1 border-b-2 border-brand pb-1 font-serif text-2xl font-semibold text-brand">Berita terbaru</h2>
        <div className="grid gap-x-8 md:grid-cols-2">{feed.map((a) => <RowCard key={a.id} a={a} />)}</div>
        <LoadMore start={17} initialDone={all.length < 17} />
      </section>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">{BLOCKS.map((c) => <CategoryBlock key={c} category={c} />)}</div>
    </div>
  );
}
