import * as cheerio from 'cheerio';
import {isLogoImage} from './article-image';

/**
 * Ekstraktor "HTML Listing" — sumber berita yang TIDAK punya RSS.
 *
 * Cara kerja: baca satu halaman daftar (mis. https://www.beautyhaul.com/blog/film-series), ambil
 * setiap kartu artikel (judul, URL, tanggal, gambar, kategori), lalu — hanya untuk artikel yang
 * benar-benar baru — buka halaman artikelnya sekali untuk melengkapi deskripsi, penulis, dan
 * alamat kanonik.
 *
 * Aturan yang dipegang:
 *  • Tidak mengarang: kolom yang tidak ada di halaman dibiarkan kosong, bukan ditebak.
 *  • Tanggal hanya diterima bila tertulis di halaman. Tanggal tanpa jam diperlakukan sebagai
 *    ketelitian HARI (00:00 WITA), bukan jam karangan.
 *  • Hanya alamat gambar yang diambil; berkas tidak disalin atau diunggah ulang.
 */

export type ListingItem = {
  url: string;
  canonical: string | null;
  title: string;
  publishedAt: string | null;
  datePrecision: 'day' | 'instant' | null;
  description: string | null;
  author: string | null;
  image: string | null;
  category: string | null;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9,
  oktober: 10, november: 11, desember: 12,
};

/** Alamat yang jelas bukan gambar berita. */
const NOT_IMAGE = /(?:placeholder|logo|favicon|icon[-_/]|sprite|avatar|spacer|1x1|pixel|gravatar|\/static\/assets\/)/i;
/** Logo situs (mis. logo Google News 300×300) bukan foto berita — lihat isLogoImage(). */
function logoish(url: string): boolean { return isLogoImage(url); }

/** Kata yang menandakan kartu itu bagian navigasi, bukan artikel. */
const NAV_SLUGS = new Set(['latest', 'beauty-event', 'skincare', 'makeup', 'hair-care', 'body-care', 'fragrance',
  'film-series', 'pop-culture', 'music', 'celebrity', 'beauty', 'fashion', 'food', 'life', 'health', 'review',
  'promo', 'event', 'tips', 'news', 'all', 'home']);

function clean(value: string): string {
  return value.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Buang tanggal dan tempelan kategori dari judul kartu ("Film & Series 29 Oct 2026 Judul …"). */
export function cleanTitle(raw: string, category: string | null): string {
  let text = clean(raw);
  text = text.replace(/\b\d{1,2}\s+[A-Za-z]{3,9}\.?\s+20\d\d\b/g, ' ').replace(/\b20\d\d-\d\d-\d\d\b/g, ' ');
  text = clean(text);
  if (category) {
    const lower = text.toLowerCase(), cat = category.toLowerCase();
    if (lower.startsWith(cat)) text = clean(text.slice(category.length));
  }
  return text.replace(/^[\s·•|:\-–—]+/, '').replace(/[\s·•|:\-–—]+$/, '').trim();
}

/** "29 Oct 2026" / "29 Oktober 2026" / "2026-10-29" → ISO ketelitian hari (00:00 WITA). */
export function parseListingDate(text: string): string | null {
  const named = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(20\d\d)\b/.exec(text);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month) {
      const day = Number(named[1]);
      const year = Number(named[3]);
      // Tanggal dari halaman tidak memuat jam. Jangan menghitung lewat Date (bisa bergeser sehari);
      // tulis langsung sebagai tengah malam WITA, ketelitian HARI.
      if (day >= 1 && day <= 31) {
        const mm = String(month).padStart(2, '0'), dd = String(day).padStart(2, '0');
        return `${year}-${mm}-${dd}T00:00:00+08:00`;
      }
    }
  }
  const iso = /\b(20\d\d)-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?(Z|[+-]\d\d:?\d\d)?\b/.exec(text);
  if (iso) {
    const [, y, mo, d, hh, mm, ss, zone] = iso;
    if (!hh) return `${y}-${mo}-${d}T00:00:00+08:00`;
    const tz = !zone ? '+08:00' : zone === 'Z' ? 'Z' : (zone.length === 5 ? zone : zone.slice(0, 3) + ':' + zone.slice(3));
    const stamp = new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss || '00'}${tz}`);
    return Number.isFinite(stamp.getTime()) ? stamp.toISOString() : null;
  }
  return null;
}

function absolute(raw: string | undefined | null, base: string): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/&amp;/g, '&');
  if (!value || value.length > 900 || /^data:/i.test(value)) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Gambar utama dari sebuah kartu: <picture><source srcset> lebih dulu, lalu <img>. */
function cardImage(scope: cheerio.Cheerio<any>, base: string): string | null {
  const source = scope.find('source[srcset]').toArray()
    .map(node => String(scope.find('source[srcset]').eq(0).attr('srcset') || ''))
    .map(set => set.split(',')[0]?.trim().split(/\s+/)[0] || '')
    .find(v => v);
  const fromSource = absolute(source, base);
  if (fromSource && !NOT_IMAGE.test(fromSource) && !logoish(fromSource)) return fromSource;
  for (const node of scope.find('img').toArray()) {
    const el = scope.find('img').eq(0);
    for (const attr of ['src', 'data-src', 'data-lazy-src']) {
      const found = absolute(el.attr(attr), base);
      if (found && !NOT_IMAGE.test(found) && !logoish(found)) return found;
    }
    void node;
  }
  // Beberapa templat menaruh URL CDN langsung di atribut lain.
  const anyCdn = scope.html()?.match(/https?:\/\/[^\s"'<>()]+\.(?:jpe?g|png|webp|avif)/gi) || [];
  for (const candidate of anyCdn) {
    if (!NOT_IMAGE.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Ambil kartu-kartu artikel dari halaman daftar.
 * `pathPrefix` membatasi tautan yang dianggap artikel (mis. `/blog/`).
 */
export function extractListing(html: string, listingUrl: string, opts: {pathPrefix?: string; minSlug?: number} = {}): ListingItem[] {
  const base = new URL(listingUrl);
  const prefix = opts.pathPrefix ?? new URL(listingUrl).pathname.replace(/\/[^/]*$/, '/');
  const minSlug = opts.minSlug ?? 18;
  const $ = cheerio.load(html.slice(0, 1_500_000));
  const seen = new Set<string>();
  const out: ListingItem[] = [];

  for (const node of $('a[href]').toArray()) {
    const el = $(node);
    const href = el.attr('href');
    const url = absolute(href, listingUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.hostname !== base.hostname) continue;
    if (!parsed.pathname.startsWith(prefix)) continue;
    // Artikel boleh beralamat dua tingkat (mis. /berita/judul-panjang); yang dinilai adalah
    // bagian terakhirnya. Halaman bagian (mis. /blog/music) punya bagian akhir yang pendek/sama
    // dengan nama rubrik, jadi tersaring oleh aturan di bawah.
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';
    if (last.length < minSlug) continue;
    if (NAV_SLUGS.has(last.toLowerCase())) continue;
    if (/^(?:index|page|home)\.?[a-z]*$/i.test(last)) continue;
    const slug = last;
    if (seen.has(parsed.href)) continue;

    // Naik ke atas SELAMA wadah itu masih memuat tepat SATU artikel. Begitu naik lebih jauh,
    // teks kartu sebelah ikut terbawa dan tanggal/judul bisa tertukar — itu pernah terjadi.
    const countArticles = (scope: cheerio.Cheerio<any>) => {
      const found = new Set<string>();
      for (const link of scope.find('a[href]').toArray()) {
        const target = absolute($(link).attr('href'), listingUrl);
        if (!target) continue;
        const u = new URL(target);
        if (u.hostname !== base.hostname || !u.pathname.startsWith(prefix)) continue;
        const parts = u.pathname.split('/').filter(Boolean);
        const tail = parts[parts.length - 1] || '';
        if (tail.length < minSlug || NAV_SLUGS.has(tail.toLowerCase())) continue;
        if (/^(?:index|page|home)\.?[a-z]*$/i.test(tail)) continue;
        found.add(u.href);
      }
      return found.size;
    };
    let scope = el;
    let card: cheerio.Cheerio<any> | null = null;
    for (let depth = 0; depth < 7; depth += 1) {
      const parent = scope.parent();
      if (!parent.length) break;
      if (countArticles(parent) > 1) break; // sudah masuk wilayah kartu lain
      scope = parent;
      const text = clean(scope.text());
      const hasDate = /\b\d{1,2}\s+[A-Za-z]{3,9}\.?\s+20\d\d\b/.test(text) || /\b20\d\d-\d\d-\d\d\b/.test(text);
      if (hasDate && scope.find('img, picture, source').length > 0) card = scope;
    }
    const box = card ?? el;
    const text = clean(box.text());

    // Kategori lebih dulu, karena judul perlu dibersihkan dari tempelan kategori & tanggal.
    const category = box.find('[class*="rounded-full"]').toArray()
      .map(n => clean($(n).text()))
      .find(t => t && t.length <= 40 && !/\d{4}/.test(t)) || null;
    // Judul: judul di dalam kartu bila ada, kalau tidak teks tautannya.
    let title = cleanTitle(box.find('h1,h2,h3,h4').first().text(), category);
    if (title.length < 12) title = cleanTitle(el.text(), category);
    if (title.length < 12) title = cleanTitle(String(box.attr('title') || ''), category);
    if (title.length < 10) continue;

    const dateText = (/\b\d{1,2}\s+[A-Za-z]{3,9}\.?\s+20\d\d\b/.exec(text) || /\b20\d\d-\d\d-\d\d\b/.exec(text) || [])[0] || '';
    seen.add(parsed.href);
    out.push({
      url: parsed.href,
      canonical: parsed.href,
      title: title.slice(0, 300),
      publishedAt: parseListingDate(dateText),
      datePrecision: dateText ? 'day' : null,
      description: null,
      author: null,
      image: cardImage(box, listingUrl),
      category,
    });
  }
  return out;
}

/** Lengkapi satu artikel dari halaman detailnya sendiri. Tidak pernah melempar. */
export function extractArticleDetail(html: string, url: string): Partial<ListingItem> {
  const $ = cheerio.load(html.slice(0, 1_200_000));
  const meta = (selector: string, attr = 'content') => clean(String($(selector).first().attr(attr) || '')) || null;
  const canonical = absolute($('link[rel="canonical"]').first().attr('href'), url) || null;
  const ld = $('script[type="application/ld+json"]').toArray()
    .map(n => $(n).contents().text()).join(' ')
    .replace(/\s+/g, ' ');
  const ldField = (name: string) => {
    const m = new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`).exec(ld);
    return m ? clean(m[1]) : null;
  };
  const time = $('time[datetime]').first().attr('datetime') || '';
  /**
   * Tanggal & penulis diambil dari KEPALA artikel, bukan dari kartu daftar.
   * Templat seperti BeautyHaul menulis "By <nama> · 09 Oct 2026" di kepala artikel; tanggal pada
   * kartu daftar bisa tertukar dengan kartu sebelah, jadi hanya dipakai sebagai cadangan.
   */
  const raw = html.slice(0, 400_000);
  const byIndex = raw.search(/\bBy\s*(?:<\/span>)?\s*[:·]?\s*[A-Z]/);
  const header = byIndex >= 0 ? raw.slice(byIndex, byIndex + 2500) : raw.slice(0, 20000);
  const headerDate = (header.match(/\b\d{1,2}\s+[A-Za-z]{3,9}\.?\s+20\d\d\b/) || [])[0] || '';
  const cleanClient = (value: string) => clean(value.replace(/<[^>]*>/g, ' '));
  const byline = byIndex >= 0
    ? cleanClient((raw.slice(byIndex, byIndex + 160).match(/\bBy\s*(?:<\/span>)?\s*[:·]?\s*([A-Za-z][A-Za-z.'\- ]{2,60})/) || [])[1] || '')
    : '';
  const published = parseListingDate(ldField('datePublished') || time || headerDate || '');
  const title = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]')
    || clean($('h1').first().text()) || clean($('title').first().text()) || null;
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]') || ldField('description');
  const author = meta('meta[name="author"]') || meta('meta[property="article:author"]') || ldField('author')
    || (byline && byline.length >= 3 ? byline.trim() : null);
  const image = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || null;
  return {
    ...(canonical ? {canonical} : {}),
    ...(title ? {title: title.slice(0, 300)} : {}),
    ...(description ? {description: description.slice(0, 400)} : {}),
    ...(author ? {author: author.slice(0, 120)} : {}),
    ...(published ? {publishedAt: published, datePrecision: /T\d\d:\d\d/.test(String(ldField('datePublished') || time)) ? 'instant' : 'day'} : {}),
    ...(author && author.length >= 3 ? {author: author.trim().slice(0, 120)} : {}),
    ...(image && /^https:\/\//i.test(image) && !NOT_IMAGE.test(image) ? {image} : {}),
  };
}

/**
 * Kata kunci penentu bahwa sebuah artikel memang berita hiburan Asia
 * (Drakor, Dracin, K-Pop, aktor/aktris Korea–China, film & serial Asia).
 * Sengaja tidak memakai kata umum seperti "film" saja, supaya artikel kecantikan
 * (mis. "film terbaik untuk kulit") tidak ikut masuk.
 */
export const ENTERTAINMENT_TOPICS: {tag: string; pattern: RegExp}[] = [
  {tag: 'Drakor', pattern: /\b(drakor|drama\s+korea|korean\s+drama|kdrama|k-drama)\b/i},
  {tag: 'Dracin', pattern: /\b(drac+hin|dracin|drama\s+(?:china|tiongkok)|chinese\s+drama|cdrama|c-drama)\b/i},
  {tag: 'K-Pop', pattern: /\b(k-?pop|idol\s+group|girl\s*group|boy\s*group|bts|blackpink|twice|aespa|stray\s+kids|exo|seventeen|enhypen|itzy|newjeans|le\s+sserafim|nct|red\s+velvet|got7|monsta\s*x)\b/i},
  {tag: 'Aktor Korea/China', pattern: /\b(aktor|aktris|actor|actress|pemain|dibintangi|berperan)\b[^.]{0,60}\b(korea|korean|china|chinese|tiongkok)\b/i},
  // "Film Indonesia" & festival di Asia tetap film Asia. Film Barat (mis. tema Halloween) tidak lolos
  // karena tidak memuat kata kawasan mana pun.
  {tag: 'Film & Serial Asia', pattern: /\b(film|serial|series|movie|drama|anime|manga|webtoon)\b[^.]{0,70}\b(korea|korean|china|chinese|jepang|japan|thailand|thai|asia|indonesia|bollywood|busan|tokyo|hallyu|film festival|festival film)\b/i},
];

/** Topik hiburan yang cocok, atau `null` bila artikel bukan soal hiburan Asia. */
export function entertainmentTopic(...parts: (string | null | undefined)[]): string | null {
  const haystack = parts.filter(Boolean).join(' · ');
  for (const topic of ENTERTAINMENT_TOPICS) if (topic.pattern.test(haystack)) return topic.tag;
  return null;
}
