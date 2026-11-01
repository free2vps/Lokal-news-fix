import * as cheerio from 'cheerio';
import type { IncomingItem } from '../domain/editorial';

/**
 * Offline parser for the supplied Lombok Timur listing only.
 * The listing observed on 27 Oct 2026 exposed title/link but no publication date
 * in the extracted listing. This parser never fetches articles or invents dates.
 * Network access, rights checks and collection are intentionally NOT wired up.
 */
export function parseLombokTimurListing(html: string): IncomingItem[] {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 2_000_000) throw new Error('LISTING_TOO_LARGE');
  const $ = cheerio.load(html), seen = new Set<string>(), items: IncomingItem[] = [];
  $('a[href]').each((_, element) => {
    if (items.length >= 50) return;
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (text.length < 8 || text.length > 300 || /^lihat$/i.test(text)) return;
    let url: URL;
    try { url = new URL($(element).attr('href') || '', 'https://portal.lomboktimurkab.go.id/'); } catch { return; }
    if (url.origin !== 'https://portal.lomboktimurkab.go.id' || url.username || url.password || url.search || url.hash) return;
    const match = /^\/baca-berita-(\d+)-[^/]+\.html$/i.exec(url.pathname);
    if (!match || seen.has(match[1])) return;
    seen.add(match[1]);
    items.push({ sourceId: 'gov-ntb-lombok-timur', externalId: `lotim:${match[1]}`, url: url.href, title: text, snippet: null, sourcePublishedAt: null, sourceDateRaw: null });
  });
  return items;
}
