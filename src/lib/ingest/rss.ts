import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { http } from './http';
import type { RawItem } from './scraper';
import type { Source } from '../types';

const parser = new Parser({ customFields: { item: [['media:content', 'media'], ['content:encoded', 'encoded']] } });

export async function fetchRss(source: Pick<Source, 'url'>): Promise<RawItem[]> {
  const feed = await parser.parseString(await http(source.url));
  return feed.items.slice(0, 15).flatMap((i: any) => {
    const html: string = i.encoded || i.content || i.summary || i.contentSnippet || '';
    const $ = cheerio.load(html);
    const image = i.enclosure?.url || i.media?.$?.url || $('img').first().attr('src') || null;
    const text = $.root().text().replace(/\s+/g, ' ').trim().slice(0, 3000);
    return i.link && i.title ? [{ url: i.link as string, title: String(i.title).trim(), text, image, publishedAt: i.isoDate || i.pubDate || null }] : [];
  });
}
