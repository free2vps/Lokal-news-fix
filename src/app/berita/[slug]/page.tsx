import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBySlug, getRelated, getLatest } from '@/lib/queries';
import { SITE } from '@/config/site';
import { regionName, splitByRegion } from '@/config/regions';
import { formatDate, slugify } from '@/lib/utils';
import type { Article } from '@/lib/types';
import AdSlot from '@/components/AdSlot';
import JsonLd from '@/components/JsonLd';
import NewsCard from '@/components/NewsCard';

export const revalidate = 3600;
type P = { params: Promise<{ slug: string }> };

/** Kartu 1200x630 buatan sendiri; dipakai bila foto sumber lebih kecil dari 1200px (syarat Discover). */
const card = (a: Article) => ({ url: `/api/og?t=${encodeURIComponent(a.title)}&s=${encodeURIComponent(a.source_name)}&n=${encodeURIComponent(SITE.name)}`, width: 1200, height: 630 });
const photoOk = (a: Article) => !!a.image_url && (a.image_width ?? 0) >= 1200 && (a.image_height ?? 0) > 0;
const shareImage = (a: Article) => (photoOk(a) ? { url: a.image_url!, width: a.image_width!, height: a.image_height! } : card(a));

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const a = await getBySlug((await params).slug);
  if (!a) return {};
  const title = a.meta_title || a.title;
  const description = a.meta_description || a.ai_summary.slice(0, 155);
  const img = shareImage(a);
  return {
    title, description, alternates: { canonical: `/berita/${a.slug}` }, keywords: a.tags,
    robots: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
    openGraph: { type: 'article', title, description, url: `/berita/${a.slug}`, publishedTime: a.published_at, section: a.category, tags: a.tags, images: [{ ...img, alt: a.title }] },
    twitter: { card: 'summary_large_image', title, description, images: [img.url] },
  };
}

function Linked({ text, used }: { text: string; used: Set<string> }) {
  return <>{splitByRegion(text, used).map((p, i) => typeof p === 'string' ? p : <Link key={i} href={`/wilayah/${p.slug}`} className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand">{p.text}</Link>)}</>;
}

export default async function Detail({ params }: P) {
  const a = await getBySlug((await params).slug);
  if (!a) notFound();
  const [related, latest] = await Promise.all([getRelated(a), getLatest({ limit: 5 })]);
  const paragraphs = a.ai_summary.split(/\n{2,}/);
  const url = `${SITE.url}/berita/${a.slug}`;
  const abs = (u: string) => (u.startsWith('http') ? u : SITE.url + u);
  const region = regionName(a.region);
  const used = new Set<string>();
  const images = [...(photoOk(a) ? [a.image_url!] : []), abs(card(a).url)];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <JsonLd data={{
        '@context': 'https://schema.org', '@type': 'NewsArticle', headline: (a.meta_title || a.title).slice(0, 110),
        description: a.meta_description, image: images, thumbnailUrl: images[0], datePublished: a.published_at, dateModified: a.published_at,
        inLanguage: 'id-ID', articleSection: a.category, keywords: a.tags?.join(', '), mainEntityOfPage: url, isBasedOn: a.source_url,
        ...(region ? { contentLocation: { '@type': 'Place', name: region } } : {}),
        author: { '@type': 'Organization', name: SITE.name, url: SITE.url }, publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
        sourceOrganization: { '@type': 'Organization', name: a.source_name },
      }} />
      <JsonLd data={{
        '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Beranda', item: SITE.url },
          { '@type': 'ListItem', position: 2, name: a.category, item: `${SITE.url}/kategori/${slugify(a.category)}` },
          { '@type': 'ListItem', position: 3, name: a.title, item: url }] }} />

      <article className="min-w-0">
        <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap gap-x-2 text-sm text-muted">
          <Link href="/" className="hover:text-brand">Beranda</Link><span aria-hidden>/</span>
          <Link href={`/kategori/${slugify(a.category)}`} className="hover:text-brand">{a.category}</Link><span aria-hidden>/</span>
          <span className="line-clamp-1 max-w-[16rem]" aria-current="page">{a.title}</span>
        </nav>

        <h1 className="font-serif text-3xl font-semibold leading-tight md:text-4xl">{a.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <Link href={`/kategori/${slugify(a.category)}`} className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-bg">{a.category}</Link>
          {region && <Link href={`/wilayah/${a.region}`} className="hover:text-brand">{region}</Link>}
          <time dateTime={a.published_at}>{formatDate(a.published_at)}</time>
          <span>Sumber asli: <strong className="font-medium text-ink">{a.source_name}</strong></span>
        </div>

        {a.image_url && (
          <figure className="mt-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.image_url} alt={a.title} width={a.image_width ?? undefined} height={a.image_height ?? undefined} fetchPriority="high" referrerPolicy="no-referrer" decoding="async" className="aspect-[16/9] w-full rounded-lg bg-line/50 object-cover" />
            <figcaption className="mt-1.5 text-xs text-muted">Foto: {a.image_credit || a.source_name}</figcaption>
          </figure>
        )}

        <section aria-labelledby="ringkasan" className="mt-6 rounded-lg border-l-4 border-brand bg-surface p-5">
          <h2 id="ringkasan" className="font-serif text-lg font-semibold text-brand">Ringkasan</h2>
          <div className="mt-2 text-[1.0625rem] leading-8">
            {paragraphs.map((p, i) => (
              <div key={i} className={i ? 'mt-4' : ''}>
                {i > 0 && a.section_headings?.[i - 1] && <h3 className="mb-1 font-serif text-xl font-semibold">{a.section_headings[i - 1]}</h3>}
                <p className={i === 0 ? 'font-medium' : ''}><Linked text={p} used={used} /></p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">{a.slug.includes('-hub-') ? 'Pratinjau otomatis berbasis teks sumber, tanpa AI.' : 'Ringkasan otomatis.'} Sumber: {a.source_name}. Rujuk artikel asli untuk informasi lengkap dan akurat.</p>
        </section>

        <div className="my-6"><AdSlot slot="inArticle" /></div>

        {!!a.key_points?.length && (
          <section aria-labelledby="poin" className="rounded-lg border border-line bg-surface p-5">
            <h2 id="poin" className="font-serif text-lg font-semibold">Poin penting</h2>
            <ul className="mt-3 space-y-2">
              {a.key_points.map((k, i) => <li key={i} className="flex gap-3"><span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />{k}</li>)}
            </ul>
          </section>
        )}

        <div className="my-8 text-center">
          <a href={a.source_url} target="_blank" rel="nofollow noopener" className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3.5 text-base font-semibold text-[#1b1405] shadow-sm hover:brightness-95">
            Baca Artikel Selengkapnya di {a.source_name}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
          <p className="mt-2 text-xs text-muted">Hak cipta isi berita dimiliki {a.source_name}. <Link href="/disclaimer" className="underline">Disclaimer</Link></p>
        </div>

        {!!a.tags?.length && (
          <p className="flex flex-wrap gap-2 text-sm">
            {a.tags.map((t) => <Link key={t} href={`/topik/${encodeURIComponent(t)}`} className="rounded-full border border-line px-3 py-0.5 text-muted hover:border-brand hover:text-brand">{t}</Link>)}
          </p>
        )}

        {related.length > 0 && (
          <section aria-labelledby="terkait" className="mt-10">
            <h2 id="terkait" className="mb-4 border-l-4 border-accent pl-3 font-serif text-2xl font-semibold">{region ? `Berita ${region} lainnya` : 'Berita terkait'}</h2>
            <div className="grid gap-5 sm:grid-cols-2">{related.map((r) => <NewsCard key={r.id} a={r} />)}</div>
          </section>
        )}
      </article>

      <aside className="space-y-6">
        <div className="hidden lg:block"><AdSlot slot="sidebar" /></div>
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-3 font-serif text-lg font-semibold">Terbaru</h2>
          <div className="space-y-4">{latest.filter((l) => l.id !== a.id).slice(0, 4).map((l) => <NewsCard key={l.id} a={l} variant="compact" />)}</div>
        </section>
      </aside>
    </div>
  );
}
