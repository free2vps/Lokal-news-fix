import {publicFetch} from '../security/public-fetch';
import {extractListing} from './listing-extract';

/**
 * Penemuan sumber otomatis — satu alamat masuk, Hub yang mencari jalannya.
 *
 * Urutan mengikuti prioritas yang paling murah dan paling tahan lama:
 *   1. RSS / Atom          → langsung dipakai bila sah
 *   2. XML Sitemap         → menemukan URL artikel baru
 *   3. REST API publik     → (hanya bila situs mengumumkannya di <link rel=alternate>)
 *   4. HTML listing        → baca halaman daftar artikel
 *
 * Pemilik cukup menempelkan satu alamat; tidak perlu tahu mana yang ada. Ini juga yang membuat
 * RSS selalu dicoba lebih dulu ("kalau ada yang mudah, jangan dipersulit").
 */

export type DiscoveryMethod = 'rss' | 'sitemap' | 'listing' | 'none';
export type Discovery = {
  url: string;
  method: DiscoveryMethod;
  endpoint: string | null;
  items: number;
  sample: string[];
  /** True bila isi RSS lebih tua dari jendela 48 jam → sumber praktis tidak menghasilkan berita baru. */
  stale: boolean;
  notes: string[];
};

const RSS_PATHS = ['/feed', '/feed/', '/rss', '/rss/', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/blog/rss', '/blog/feed'];
const SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];

function looksRss(body: string): boolean {
  const head = body.slice(0, 4000);
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head) && /<item[\s>]|<entry[\s>]/i.test(body);
}
function looksSitemap(body: string): boolean {
  const head = body.slice(0, 2000);
  return /<urlset|<sitemapindex/i.test(head);
}
function ageDays(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const t = Date.parse(stamp);
  return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : null;
}

/** Ambil tanggal terbaru dari isi RSS/sitemap tanpa parser penuh (cukup untuk menilai kesegaran). */
function newestDate(body: string): string | null {
  const candidates = [...body.matchAll(/<(?:pubDate|published|updated|lastmod)>([^<]{8,40})<\//gi)].map(m => m[1].trim());
  let best: {t: number; raw: string} | null = null;
  for (const raw of candidates) {
    const t = Date.parse(raw);
    if (Number.isFinite(t) && (!best || t > best.t)) best = {t, raw};
  }
  return best?.raw ?? null;
}

type Fetch = (url: string) => Promise<string>;

/** Tanda-tanda situs menolak program (Cloudflare / tantangan JS). */
const BLOCK_MARKERS = /just a moment|cf-mitigated|cf-challenge|checking your browser|attention required|cf-browser-verification|captcha/i;

/** Pesan jelas untuk pemilik: ini bukan "tidak ada berita", ini situs menolak program. */
function blockedNote(error: unknown): string | null {
  const text = error instanceof Error ? `${error.message}` : String(error ?? '');
  if (/HTTP_403/.test(text)) return 'situs menolak program (proteksi bot/Cloudflare)';
  if (/HTTP_429/.test(text)) return 'situs membatasi jumlah permintaan (HTTP 429)';
  return null;
}

/** Coba beberapa alamat sebagai halaman daftar artikel; kembalikan yang paling banyak artikelnya. */
async function probeListing(load: Fetch, targets: string[]): Promise<Discovery | null> {
  let best: Discovery | null = null;
  for (const target of targets) {
    try {
      const html = await load(target);
      if (!/<html|<!doctype/i.test(html.slice(0, 2000))) continue;
      const items = extractListing(html, target);
      if (items.length < 3) continue;
      const candidate: Discovery = {
        url: target, method: 'listing', endpoint: target, items: items.length,
        sample: items.slice(0, 3).map(i => i.title), stale: items.every(i => !i.publishedAt),
        notes: [`halaman daftar memuat ${items.length} artikel`],
      };
      if (!best || candidate.items > best.items) best = candidate;
    } catch { /* lanjut ke alamat berikutnya */ }
  }
  return best;
}

/**
 * Periksa satu alamat situs dan tentukan cara pengambilannya.
 * Tidak menulis apa pun ke database; aman dipanggil sesering apa pun.
 */
export async function discover(url: string, opts: {fetcher?: Fetch; now?: number} = {}): Promise<Discovery> {
  const load: Fetch = opts.fetcher ?? ((target: string) => publicFetch(target));
  const base = new URL(url);
  const origin = base.origin;
  const notes: string[] = [];
  const blocked: string[] = [];
  const empty = (method: DiscoveryMethod, endpoint: string | null): Discovery => ({url, method, endpoint, items: 0, sample: [], stale: false, notes});

  // Bila alamat yang ditempel SUDAH berupa feed, langsung pakai.
  try {
    const direct = await load(url);
    if (looksRss(direct)) {
      const items = (direct.match(/<item[\s>]|<entry[\s>]/gi) || []).length;
      const newest = newestDate(direct);
      const age = ageDays(newest);
      return {url, method: 'rss', endpoint: url, items, sample: [...direct.matchAll(/<title[^>]*>([\s\S]{3,120}?)<\/title>/gi)].slice(1, 4).map(m => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()), stale: age !== null && age > 2, notes};
    }
  } catch { notes.push('alamat tidak dapat dibuka langsung'); }

  // 1. RSS / Atom.
  for (const path of RSS_PATHS) {
    try {
      const body = await load(origin + path);
      if (!looksRss(body)) continue;
      const items = (body.match(/<item[\s>]|<entry[\s>]/gi) || []).length;
      const age = ageDays(newestDate(body));
      const stale = age !== null && age > 2;
      const sample = [...body.matchAll(/<title[^>]*>([\s\S]{3,120}?)<\/title>/gi)].slice(1, 4).map(m => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());
      if (!stale) return {url, method: 'rss', endpoint: origin + path, items, sample, stale: false, notes};
      // RSS ada tetapi isinya sudah lama: jangan berhenti di sini — cari halaman daftar yang lebih segar.
      notes.push(`RSS ditemukan tetapi isi terbaru ${Math.round(age!)} hari lalu`);
      const fresh = await probeListing(load, [url, origin + '/']);
      if (fresh) return {...fresh, notes: [...notes, ...fresh.notes]};
      return {url, method: 'rss', endpoint: origin + path, items, sample, stale: true, notes};
    } catch (e) { const note = blockedNote(e); if (note) blocked.push(note); }
  }

  // 2. Sitemap.
  for (const path of SITEMAP_PATHS) {
    try {
      const body = await load(origin + path);
      if (!looksSitemap(body)) continue;
      const urls = [...body.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1].trim());
      const articles = urls.filter(u => !/\.(?:xml|jpg|jpeg|png|webp|pdf|css|js)$/i.test(u) && u.split('/').pop()!.length > 12);
      const age = ageDays(newestDate(body));
      notes.push(`sitemap memuat ${urls.length} alamat (${articles.length} tampak artikel)`);
      return {url, method: 'sitemap', endpoint: origin + path, items: articles.length, sample: articles.slice(0, 3), stale: age !== null && age > 30, notes};
    } catch (e) { const note = blockedNote(e); if (note) blocked.push(note); }
  }

  // 3. HTML listing — baca halaman yang ditempel dan halaman beranda.
  const listing = await probeListing(load, [url, origin + '/']);
  if (listing) return {...listing, notes: [...notes, ...listing.notes]};

  if (blocked.length) {
    return {...empty('none', null), notes: [...notes, ...new Set(blocked),
      'Hub tidak dapat membaca situs ini sama sekali — termasuk robots.txt — sehingga wajib menolak menurut aturan kesopanan.',
      'Mintakan pengelola situs mengizinkan pengambil metadata "PortalContentHub/1.0" di pengaturan proteksi mereka.']};
  }
  return {...empty('none', null), notes: [...notes, 'tidak ada RSS, sitemap, maupun daftar artikel yang terbaca']};
}
