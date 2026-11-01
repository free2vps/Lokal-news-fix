import type {Client} from '@libsql/client';
import {publicFetch, checkRobots} from '../security/public-fetch';
import {acceptSourceItem} from './editorial';
import {runJob} from './operations';
import {prepareCore} from './schema-core';
import {extractListing, extractArticleDetail, entertainmentTopic, type ListingItem} from './listing-extract';

/**
 * Sumber berjenis `listing`: situs berita yang tidak punya RSS.
 *
 * Satu saklar di RSS Manager langsung memeriksa halaman daftarnya (bukan feed), lalu menyalakan
 * sumber bila halaman itu benar-benar memuat artikel.
 *
 * Batas kesopanan: satu halaman daftar per putaran, dan halaman artikel hanya dibuka untuk berita
 * yang benar-benar baru (maksimal 6), dengan robots.txt diperiksa lebih dulu.
 */

export const DETAIL_MAX = 6;

type SourceRow = {id: string; name: string; feed_url: string | null; discovered_type: string; rights_status: string; is_active: number};

async function listingSource(db: Client, id: string): Promise<SourceRow> {
  const row = (await db.execute({sql: 'SELECT * FROM hub_sources WHERE id=?', args: [id]})).rows[0];
  if (!row || !row.feed_url) throw Error('SOURCE_NOT_READY');
  return row as unknown as SourceRow;
}

export type ListingPage = {items: ListingItem[]; total: number};

/** Baca halaman daftar (tanpa menulis apa pun). */
export async function readListing(url: string, opts: {fetcher?: (url: string) => Promise<string>; pathPrefix?: string} = {}): Promise<ListingPage> {
  await checkRobots(url);
  const html = await (opts.fetcher ?? ((target: string) => publicFetch(target)))(url);
  if (!/<html|<!doctype/i.test(html.slice(0, 2000))) throw Error('LISTING_NOT_HTML');
  const items = extractListing(html, url, {pathPrefix: opts.pathPrefix});
  return {items, total: items.length};
}

/** Satu saklar: memeriksa halaman daftar lalu (bila berhasil) menandai sumber siap. */
export async function verifyListing(db: Client, id: string) {
  const source = await listingSource(db, id);
  return runJob(db, 'listing-verify:' + id, async () => {
    const page = await readListing(String(source.feed_url));
    if (!page.items.length) throw Error('LISTING_EMPTY');
    await db.execute({sql: "UPDATE hub_sources SET discovered_type='html_listing',updated_at=? WHERE id=?", args: [new Date().toISOString(), id]});
    return {value: {verified: true, count: page.items.length, active: Number(source.is_active) === 1}, count: page.items.length};
  });
}

export type ListingSyncResult = {
  inserted: number; skipped: number; filtered: number; enriched: number; processed: number; publicationEnabled: false;
};

/**
 * Tarik artikel baru dari halaman daftar.
 * `topicFilter` (opsional) membatasi hanya berita yang cocok kata kunci tertentu — mis. hiburan Asia.
 */
export async function syncListing(db: Client, id: string, opts: {fetcher?: (url: string) => Promise<string>; topicFilter?: boolean; now?: number} = {}) {
  await prepareCore(db).catch(() => {});
  const load = opts.fetcher ?? ((target: string) => publicFetch(target));
  const source = await listingSource(db, id);
  if (Number(source.is_active) !== 1 || String((source as unknown as {discovered_type: string}).discovered_type) !== 'html_listing' || source.rights_status === 'unknown') throw Error('SOURCE_NOT_READY');

  return runJob(db, 'listing:' + id, async () => {
    const page = await readListing(String(source.feed_url), {fetcher: load});
    let inserted = 0, skipped = 0, filtered = 0, enriched = 0;

    for (const item of page.items) {
      // 1. Saring topik (bila sumber memintanya).
      if (opts.topicFilter) {
        const topic = entertainmentTopic(item.title, item.category);
        if (!topic) { filtered += 1; continue; }
      }
      // 2. Sudah pernah dilihat? Jangan buka halaman detailnya lagi.
      const existing = (await db.execute({sql: 'SELECT id FROM hub_items WHERE source_id=? AND normalized_original_url=? LIMIT 1', args: [id, item.url]})).rows[0];
      if (existing) { skipped += 1; continue; }
      // 3. Berita baru: buka halaman artikelnya SEKALI untuk melengkapi deskripsi/penulis/kanonik.
      let detail: Partial<ListingItem> = {};
      if (enriched < DETAIL_MAX) {
        try {
          await checkRobots(item.url);
          detail = extractArticleDetail(await load(item.url), item.url);
          enriched += 1;
        } catch { detail = {}; }
      }
      const title = String(detail.title || item.title).trim();
      const publishedAt = detail.publishedAt || item.publishedAt;
      // Tanpa tanggal yang bisa dipercaya, berita TIDAK diambil: lebih baik kosong daripada tanggal karangan.
      if (!title || !publishedAt) { filtered += 1; continue; }
      const image = detail.image || item.image;
      const description = detail.description || null;
      const topic = opts.topicFilter ? entertainmentTopic(title, item.category, description) : null;
      if (opts.topicFilter && !topic) { filtered += 1; continue; }

      const result = await acceptSourceItem(db, {
        sourceId: id,
        externalId: detail.canonical || item.canonical || item.url,
        url: item.url,
        title,
        snippet: description ? description.slice(0, 1500) : null,
        sourcePublishedAt: publishedAt,
        sourceDateRaw: (item.publishedAt || '').slice(0, 150) || null,
        imageUrl: image,
      });
      if (result.status === 'inserted') inserted += 1; else skipped += 1;
    }

    return {
      value: {inserted, skipped, filtered, enriched, processed: page.items.length, publicationEnabled: false} as ListingSyncResult,
      count: inserted,
      status: 'SUCCESS' as const,
    };
  });
}
