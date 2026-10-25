import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { http } from './http';
import type { RawItem } from './scraper';
import type { Source } from '../types';

const parser = new Parser({ customFields: { item: [['media:content', 'media'], ['content:encoded', 'encoded']] } });

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };

/** Format "7 Mar 2026 10:24:0" (diasumsikan WIB) menjadi ISO. */
function parseLooseDate(s?: string) {
  const m = s?.trim().match(/^(\d{1,2}) (\w{3}) (\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  const mo = m ? MONTHS[m[2].toLowerCase()] : undefined;
  return m && mo !== undefined ? new Date(Date.UTC(+m[3], mo, +m[1], +m[4] - 7, +m[5], +m[6])).toISOString() : null;
}

/** Format kustom <rss><articles><article> (mis. Zetizen), bukan <channel><item> standar. */
function parseArticlesFeed(xml: string): RawItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('articles > article').toArray().flatMap((el) => {
    const a = $(el);
    const url = a.children('sourceUrl').text().trim();
    const title = a.children('title').text().trim();
    const text = cheerio.load(a.children('contents').children('text').children('content').text()).root().text().replace(/\s+/g, ' ').trim().slice(0, 3000);
    const image = a.children('contents').children('image').children('url').text().trim() || null;
    const publishedAt = parseLooseDate(a.children('publishTimeUnix').text());
    return url && title ? [{ url, title, text, image, publishedAt }] : [];
  }).sort((x, y) => +new Date(y.publishedAt ?? 0) - +new Date(x.publishedAt ?? 0)).slice(0, 15);
}

export async function fetchRss(source: Pick<Source, 'url'>): Promise<RawItem[]> {
  const xml = await http(source.url);
  if (/<articles[\s>]/.test(xml)) return parseArticlesFeed(xml);
  let feed;
  try { feed = await parser.parseString(xml); }
  catch (e) { throw new Error(`format feed tidak standar (bukan RSS/Atom biasa): ${(e as Error).message}`); }
  return feed.items.slice(0, 15).flatMap((i: any) => {
    const html: string = i.encoded || i.content || i.summary || i.contentSnippet || '';
    const $ = cheerio.load(html);
    const image = i.enclosure?.url || i.media?.$?.url || $('img').first().attr('src') || null;
    const text = $.root().text().replace(/\s+/g, ' ').trim().slice(0, 3000);
    return i.link && i.title ? [{ url: i.link as string, title: String(i.title).trim(), text, image, publishedAt: i.isoDate || i.pubDate || null }] : [];
  });
}
