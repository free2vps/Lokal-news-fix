import * as cheerio from 'cheerio';
import { http } from './http';
import type { Source } from '../types';

export type RawItem = { url: string; title: string; text: string; image?: string | null; publishedAt?: string | null };

const abs = (u: string | undefined, base: string) => { try { return u ? new URL(u, base).toString() : null; } catch { return null; } };

/** Ambil daftar tautan artikel dari halaman indeks (situs non-RSS). */
export async function scrapeList(source: Pick<Source, 'url' | 'selectors'>): Promise<string[]> {
  const $ = cheerio.load(await http(source.url));
  const base = new URL(source.url);
  const sel = source.selectors?.link;
  const out = new Set<string>();
  $(sel || 'a[href]').each((_, a) => {
    const href = abs($(a).attr('href'), source.url);
    if (!href) return;
    const u = new URL(href);
    if (u.origin !== base.origin) return;
    if (u.pathname.replace(/\/$/, '') === base.pathname.replace(/\/$/, '')) return; // halaman indeks/pagination
    if (!sel && !/\/(berita|news|post|read|artikel|detail)\//i.test(u.pathname)) return; // heuristik bila tanpa selector
    u.hash = '';
    out.add(u.toString());
  });
  return [...out].slice(0, 15);
}

/** Ambil judul, gambar utama, tanggal, dan teks ringkas dari satu halaman artikel. */
export async function scrapeArticle(url: string, selectors?: Source['selectors']): Promise<RawItem | null> {
  const $ = cheerio.load(await http(url));
  const meta = (p: string) => $(`meta[property="${p}"]`).attr('content') || $(`meta[name="${p}"]`).attr('content') || '';
  const title = (meta('og:title') || $('h1').first().text() || $('title').text()).replace(/\s+/g, ' ').trim();
  const root = $(selectors?.article || 'article, .entry-content, .post-content, .article-content, .content, main').first();
  const scope = root.length ? root : $('body');
  let text = scope.find('p').map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get().filter((t) => t.length > 40).join('\n\n').slice(0, 4000);
  if (text.length < 120) text = meta('og:description') || meta('description');
  const image = abs(meta('og:image') || scope.find('img').first().attr('src'), url);
  const publishedAt = meta('article:published_time') || $('time').first().attr('datetime') || null;
  if (!title || !text) return null;
  return { url, title, text, image, publishedAt };
}
