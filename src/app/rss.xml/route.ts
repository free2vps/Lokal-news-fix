import { SITE } from '@/config/site';
import { getRecentRows } from '@/lib/queries';

/**
 * Umpan RSS 50 berita terbaru.
 *
 * Kegunaan nyata: pembaca setia bisa mengikuti tanpa aplikasi, agregator (termasuk beberapa
 * layanan berita) bisa mengambil isi secara resmi, dan Google menerima tautan RSS sebagai
 * sinyal tambahan. Murah dibuat, tidak menambah beban server karena memakai cache yang sama.
 */
export const revalidate = 300;

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export async function GET() {
  const rows = await getRecentRows(24 * 30, 50).catch(() => []);
  const items = rows
    .filter((r) => r.title)
    .map((r) => {
      const link = `${SITE.url}/berita/${r.slug}`;
      return `    <item>
      <title>${esc(r.title as string)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pubDate>${new Date(r.published_at).toUTCString()}</pubDate>
      ${r.category ? `<category>${esc(r.category)}</category>` : ''}
      <description>${esc((r.ai_summary || '').slice(0, 400))}</description>
      ${r.source_name ? `<source url="${esc(SITE.url)}">${esc(r.source_name)}</source>` : ''}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE.name)}</title>
    <link>${esc(SITE.url)}</link>
    <description>${esc(SITE.description)}</description>
    <language>id</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${esc(`${SITE.url}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
