import type { MetadataRoute } from 'next';
import { SITE } from '@/config/site';
import { getSitemapRows } from '@/lib/queries';
import { CATEGORIES, slugify } from '@/lib/utils';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await getSitemapRows();
  return [
    { url: SITE.url, changeFrequency: 'hourly', priority: 1 },
    ...CATEGORIES.map((c) => ({ url: `${SITE.url}/kategori/${slugify(c)}`, changeFrequency: 'hourly' as const, priority: 0.6 })),
    ...['disclaimer', 'pedoman-media', 'privacy-policy'].map((p) => ({ url: `${SITE.url}/${p}`, changeFrequency: 'yearly' as const, priority: 0.2 })),
    ...rows.map((r) => ({ url: `${SITE.url}/berita/${r.slug}`, lastModified: r.published_at, changeFrequency: 'weekly' as const, priority: 0.8 })),
  ];
}
