import { getLatest, getTrending, getMixedPage, getActiveRegions } from '@/lib/queries';
import { SITE } from '@/config/site';
import { ADS, type AdKey } from '@/config/ads';
import type { Article } from '@/lib/types';
import HeroCard from '@/components/HeroCard';
import HeroCarousel from '@/components/HeroCarousel';
import FeedRow from '@/components/FeedRow';
import LoadMoreFeed from '@/components/LoadMoreFeed';
import TrendingNow, { topicsOf } from '@/components/TrendingNow';
import QuickCards from '@/components/QuickCards';
import ExploreMore from '@/components/ExploreMore';
import SocialHype from '@/components/SocialHype';
import VideoShelf from '@/components/VideoShelf';
import CategoryBlock from '@/components/CategoryBlock';
import AdSlot from '@/components/AdSlot';
import JsonLd from '@/components/JsonLd';

export const revalidate = 300; // ISR 5 menit; sinkron trending memicu revalidate

const BLOCKS = ['Info Pemda', 'Peristiwa Daerah', 'Lowongan & CPNS', 'Event & Kebijakan Lokal'];
// Kolom iklan tampil bila slot diisi (atau saat pengembangan, untuk melihat placeholder)
const adOn = (k: AdKey) => ADS[k].kind !== 'none' || process.env.NODE_ENV !== 'production';

export default async function Home() {
  const hubMode=process.env.CONTENT_HUB_ENABLED==='true';
  const [news, fun, trending, regions, jobs] = await Promise.all([
    getLatest({ limit: hubMode?6:9, section: 'berita' }), getLatest({ limit: hubMode?4:2, section: 'hiburan' }),
    getTrending(), getActiveRegions(), getLatest({ limit: 1, category: 'Lowongan & CPNS' }),
  ]);
  const pool: Article[] = [...news, ...fun].sort((a, b) => hubMode ? Number(!a.region)-Number(!b.region)||(+new Date(b.published_at)-+new Date(a.published_at)) : +new Date(b.published_at)-+new Date(a.published_at));
  if (!pool.length) return <p className="py-20 text-center text-muted">Belum ada berita. Tambahkan sumber di /admin lalu klik “Sync sekarang”.</p>;

  const good = (a: Article) => !!a.image_url && (!a.image_width || a.image_width >= 600); // hindari gambar buram
  const withImg = pool.filter(good);
  const slides = withImg.slice(0, 8);
  const trio = withImg.slice(8, 11);
  const shown = new Set([...slides, ...trio].map((a) => a.id));
  const leftovers = pool.filter((a) => !shown.has(a.id));
  const feed = await getMixedPage(0, { news: news.length, fun: fun.length });

  const posts = trending.some((t) => t.kind === 'post');
  const rightTop = adOn('sidebar') || posts;
  const rightBottom = adOn('sidebar2');
  const video = trending.find((t) => t.kind === 'video');
  const cols = (right: boolean) => (right ? 'lg:grid-cols-[250px_minmax(0,1fr)_300px]' : 'lg:grid-cols-[250px_minmax(0,1fr)]');

  return (
    <div className="space-y-6">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: pool.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE.url}/berita/${a.slug}`, name: a.title })) }} />

      <QuickCards topic={topicsOf(trending)[0]} video={video} job={jobs[0]} regions={regions} />

      <div className={`grid gap-5 ${cols(rightTop)}`}>
        <aside className="order-2 lg:order-1"><TrendingNow items={trending} /></aside>
        <section aria-label="Berita utama" className="order-1 min-w-0 space-y-4 lg:order-2">
          <HeroCarousel slides={slides} />
          {trio.length > 0 && <div className="grid grid-cols-3 gap-3">{trio.map((a) => <HeroCard key={a.id} a={a} size="sm" compact />)}</div>}
        </section>
        {rightTop && (
          <aside className="order-3 space-y-4">
            <AdSlot slot="sidebar" />
            <SocialHype items={trending} />
          </aside>
        )}
      </div>

      <div className="pt-4"><VideoShelf picks={trending.filter((t) => t.kind === 'video' && t.platform === 'yt_feed')} trending={trending.filter((t) => t.kind === 'video' && t.platform === 'yt_t24')} /></div>

      <div className={`grid gap-5 pt-4 ${cols(rightBottom)}`}>
        <aside className="hidden lg:block"><div className="sticky top-32"><ExploreMore regions={regions} /></div></aside>
        <section aria-labelledby="terbaru" className="min-w-0 rounded-2xl border border-line/70 bg-surface p-4 sm:p-5">
          <h2 id="terbaru" className="mb-4 text-2xl font-bold">Berita terbaru</h2>
          {[...leftovers, ...feed].map((a) => <FeedRow key={a.id} a={a} />)}
          <LoadMoreFeed skipNews={news.length} skipFun={fun.length} initialDone={feed.length < 10} />
        </section>
        {rightBottom && <aside className="hidden lg:block"><div className="sticky top-32"><AdSlot slot="sidebar2" /></div></aside>}
      </div>

      <div className="grid gap-8 pt-4 md:grid-cols-2 lg:grid-cols-4">{BLOCKS.map((c) => <CategoryBlock key={c} category={c} />)}</div>
    </div>
  );
}
