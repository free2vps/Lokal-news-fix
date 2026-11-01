import { SITE } from '@/config/site';
import { getRecentRows } from '@/lib/queries';

/**
 * Sitemap Berita (Google News) — hanya artikel 48 jam terakhir, sesuai ketentuan Google.
 *
 * Kenapa perlu: sitemap biasa memberi tahu "halaman ini ada", tetapi sitemap berita memberi tahu
 * "ini berita BARU" beserta tanggal terbitnya. Tanpa ini, artikel baru bisa menunggu crawl
 * berhari-hari. Batas resmi: maksimal 1.000 URL dan hanya isi 2 hari terakhir.
 */
export const revalidate = 300;

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export async function GET() {
  const rows = await getRecentRows(48, 1000).catch(() => []);
  const urls = rows
    .filter((r) => r.title && r.published_at)
    .map((r) => `  <url>
    <loc>${esc(`${SITE.url}/berita/${r.slug}`)}</loc>
    <news:news>
      <news:publication>
        <news:name>${esc(SITE.name)}</news:name>
        <news:language>id</news:language>
      </news:publication>
      <news:publication_date>${new Date(r.published_at).toISOString()}</news:publication_date>
      <news:title>${esc(r.title as string)}</news:title>
    </news:news>
  </url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
