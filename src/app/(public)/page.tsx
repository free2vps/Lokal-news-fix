import Link from 'next/link';
import { getLatest, getTrending, getMixedPage, getActiveRegions, getBanner, sortByNewest, withinHours } from '@/lib/queries';
import { slugify } from '@/lib/utils';
import { isJobPosting } from '@/lib/quality';
import { SITE } from '@/config/site';
import { ADS, type AdKey } from '@/config/ads';
import type { Article } from '@/lib/types';
import HeroCard from '@/components/HeroCard';
import HeroCarousel from '@/components/HeroCarousel';
import FeedRow from '@/components/FeedRow';
import LoadMoreFeed from '@/components/LoadMoreFeed';
import TrendingNow, { topicsOf } from '@/components/TrendingNow';
import BannerPemda from '@/components/BannerPemda';
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
  const [news, fun, trending, regions, jobs, pemda, olahraga, banner] = await Promise.all([
    getLatest({ limit: hubMode?6:9, section: 'berita' }), getLatest({ limit: hubMode?4:2, section: 'hiburan' }),
    getTrending(), getActiveRegions(), getLatest({ limit: 6, category: 'Lowongan & CPNS' }),
    // Slot di bawah carousel dahulu kosong bila gambar kurang dari 9. Sekarang diisi tetap:
    // Pemda dulu, lalu Hiburan, lalu Olahraga.
    getLatest({ limit: 4, category: 'Info Pemda' }), getLatest({ limit: 4, category: 'Olahraga' }), getBanner(),
  ]);
  const pool: Article[] = [...news, ...fun].sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
  // F-03: jangan pernah menampilkan instruksi admin di halaman publik.
  // Bila belum ada berita, tampilkan jalan yang berguna bagi pembaca: wilayah & kategori.
  if (!pool.length) {
    const cats = ['Info Pemda', 'Peristiwa Daerah', 'Politik', 'Ekonomi', 'Olahraga', 'Hukum & Kriminal'];
    return (
      <div className="py-16">
        <h1 className="font-serif text-3xl font-semibold">{SITE.name}</h1>
        <p className="mt-3 max-w-prose text-muted">
          Belum ada berita yang bisa ditampilkan saat ini. Sementara itu, jelajahi berita menurut
          wilayah atau kategori di bawah ini.
        </p>
        <h2 className="mt-8 font-serif text-xl font-semibold">Menurut wilayah</h2>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {['Bali', 'NTB', 'NTT'].map((r) => <Link key={r} href={`/wilayah/${r.toLowerCase()}`} className="text-brand hover:underline">{r}</Link>)}
        </div>
        <h2 className="mt-8 font-serif text-xl font-semibold">Menurut kategori</h2>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {cats.map((c) => <Link key={c} href={`/kategori/${slugify(c)}`} className="text-brand hover:underline">{c}</Link>)}
        </div>
      </div>
    );
  }

  const good = (a: Article) => !!a.image_url && (!a.image_width || a.image_width >= 600); // hindari gambar buram
  const withImg = pool.filter(good);
  const slides = withImg.slice(0, 8);
  // Tiga kartu pengisi: satu dari Info Pemda, satu dari Hiburan, satu dari Olahraga — berurutan.
  // Bila salah satu kategori belum punya artikel bergambar, slot diisi sisa berita terbaru lain
  // supaya tidak pernah tersisa ruang kosong.
  const used = new Set(slides.map((a) => a.id));
  const pick = (list: Article[]) => {
    const a = list.find((x) => !used.has(x.id) && good(x));
    if (a) used.add(a.id);
    return a;
  };
  // Urutan yang diminta: Pemda → Hiburan → Olahraga.
  const trio: Article[] = [];
  for (const pickOne of [() => pick(pemda), () => pick(fun), () => pick(olahraga)]) {
    const a = pickOne();
    if (a) trio.push(a);
  }
  // Penting: bila salah satu kategori belum punya artikel bergambar (mis. Olahraga kosong),
  // slot TIDAK dibiarkan kosong. Diisi berita lain yang masih bergambar sampai genap tiga,
  // supaya baris di bawah carousel tidak pernah memperlihatkan celah.
  if (trio.length < 3) {
    for (const a of [...pemda, ...olahraga, ...pool, ...withImg]) {
      if (trio.length >= 3) break;
      if (used.has(a.id) || !good(a)) continue;
      used.add(a.id);
      trio.push(a);
    }
  }
  const shown = new Set([...slides, ...trio].map((a) => a.id));
  const leftovers = pool.filter((a) => !shown.has(a.id));
  // Keputusan pemilik: berita di bagian "Berita terbaru" maksimal berumur 36 jam.
  // Lebih tua dari itu tidak ditampilkan, walau kategori masih beragam.
  const FEED_HOURS = 36;
  const feed = await getMixedPage(0, { news: news.length, fun: fun.length }, { sinceHours: FEED_HOURS });
  // Urut waktu terbit (paling baru di atas), lalu saring 36 jam. Kategori boleh berulang.
  const terbaru = withinHours(sortByNewest([...leftovers, ...feed]), FEED_HOURS);

  const posts = trending.some((t) => t.kind === 'post');
  const rightTop = adOn('sidebar') || posts;
  const rightBottom = adOn('sidebar2');
  const video = trending.find((t) => t.kind === 'video');
  const cols = (right: boolean) => (right ? 'lg:grid-cols-[250px_minmax(0,1fr)_300px]' : 'lg:grid-cols-[250px_minmax(0,1fr)]');

  return (
    <div className="space-y-6">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: pool.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE.url}/berita/${a.slug}`, name: a.title })) }} />

      <QuickCards topic={topicsOf(trending)[0]} video={video} job={jobs.find((a) => isJobPosting(a.title))} regions={regions} />

      {/* Slot tetap pengumuman/iklan pemda. Tidak tampil bila tidak ada banner aktif. */}
      <BannerPemda banner={banner} />

      <div className={`grid gap-5 ${cols(rightTop)}`}>
        <aside className="order-2 lg:order-1"><TrendingNow items={trending} /></aside>
        <section aria-label="Berita utama" className="order-1 min-w-0 space-y-4 lg:order-2">
          <HeroCarousel slides={slides} />
          {trio.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {trio.map((a) => <HeroCard key={a.id} a={a} size="sm" compact />)}
            </div>
          )}
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
          {terbaru.map((a) => <FeedRow key={a.id} a={a} />)}
          {terbaru.length === 0 && (
            <p className="py-6 text-sm text-muted">
              Belum ada berita terbit dalam {FEED_HOURS} jam terakhir. Berita baru muncul otomatis
              pada pembaruan berikutnya.
            </p>
          )}
          <LoadMoreFeed skipNews={news.length} skipFun={fun.length} hours={FEED_HOURS} initialDone={feed.length === 0} initialIds={[...pool, ...feed].map(a => a.id)} />
        </section>
        {rightBottom && <aside className="hidden lg:block"><div className="sticky top-32"><AdSlot slot="sidebar2" /></div></aside>}
      </div>

      <div className="grid gap-8 pt-4 md:grid-cols-2 lg:grid-cols-4">{BLOCKS.map((c) => <CategoryBlock key={c} category={c} />)}</div>
    </div>
  );
}
