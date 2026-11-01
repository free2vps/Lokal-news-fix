import type { MetadataRoute } from 'next';
import { SITE } from '@/config/site';
import { REGIONS } from '@/config/regions';
import { getSitemapRows } from '@/lib/queries';
import { ALL_CATEGORIES, slugify } from '@/lib/utils';

export const revalidate = 300; // dibangun ulang tiap 5 menit

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = (await getSitemapRows()) as { slug: string; published_at: string; region: string | null; tags: string[] }[];
  const now = Date.now();
  const regionsWithNews = new Set(rows.map((r) => r.region).filter(Boolean));
  const tagCount = new Map<string, number>();
  for (const r of rows) for (const t of r.tags ?? []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const topTags = [...tagCount].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 200);

  return [
    { url: SITE.url, ...(rows.length ? { lastModified: rows[0].published_at } : {}), changeFrequency: 'hourly', priority: 1 },
    { url: `${SITE.url}/hiburan`, changeFrequency: 'hourly', priority: 0.8 },
    ...ALL_CATEGORIES.map((c) => ({ url: `${SITE.url}/kategori/${slugify(c)}`, changeFrequency: 'hourly' as const, priority: 0.7 })),
    ...REGIONS.filter((r) => regionsWithNews.has(r.slug)).map((r) => ({ url: `${SITE.url}/wilayah/${r.slug}`, changeFrequency: 'hourly' as const, priority: 0.8 })),
    ...topTags.map(([t]) => ({ url: `${SITE.url}/topik/${encodeURIComponent(t)}`, changeFrequency: 'daily' as const, priority: 0.5 })),
    ...['disclaimer', 'pedoman-media', 'privacy-policy'].map((p) => ({ url: `${SITE.url}/${p}`, changeFrequency: 'yearly' as const, priority: 0.2 })),
    ...rows.map((r) => {
      const fresh = now - new Date(r.published_at).getTime() < 48 * 3600_000; // berita < 48 jam diprioritaskan
      return { url: `${SITE.url}/berita/${r.slug}`, lastModified: r.published_at, changeFrequency: fresh ? ('hourly' as const) : ('weekly' as const), priority: fresh ? 0.9 : 0.6 };
    }),
  ];
}
