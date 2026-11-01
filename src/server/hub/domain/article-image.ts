import * as cheerio from 'cheerio';
import type {Client} from '@libsql/client';
import {publicFetch, checkRobots} from '../security/public-fetch';

/**
 * Mengambil URL gambar dari HALAMAN artikel, bukan dari feed.
 *
 * Sebab: sebagian penerbit (mis. Bali Puspa News, Suara NTB) mengirim feed tanpa gambar sama sekali
 * — tidak ada `enclosure`, `media:content`, maupun `<img>` di dalam konten feed — padahal halaman
 * artikelnya punya gambar utama. Tanpa langkah ini, berita dari penerbit seperti itu selalu terbit
 * tanpa gambar, dan carousel portal tidak pernah mendapat slide.
 *
 * Batasan yang dipegang:
 *  • Hanya MENGAMBIL ALAMAT gambar. Berkas tidak disalin, tidak diunggah ulang, tidak di-cache.
 *  • robots.txt diperiksa lebih dulu; `Crawl-delay` dihormati lewat jarak minimum per host.
 *  • Satu halaman paling banyak 1,5 MB dan hanya bagian kepala halaman yang dibaca.
 *  • Tidak menyentuh isi berita, tidak melewati paywall/CAPTCHA, tidak menebak alamat gambar.
 */

const MAX_URL_LENGTH = 600;
/** Pola alamat yang hampir pasti bukan gambar berita. */
// Catatan: pola iklan WAJIB memakai batas kata. Tanpa batas, "uploads/2026" ikut dianggap iklan
// karena mengandung "ads/2" — itu pernah membuat gambar berita sungguhan terbuang.
const NOT_ARTICLE_IMAGE = /(?:logo|favicon|sprite|icon[-_/]|avatar|placeholder|spacer|1x1|pixel|gravatar|emoji|\/theme\/|\/assets\/ui\/|(?:^|[^a-z])ads?[-_/.]\d|advertisement|banner[-_]?(?:iklan|ads?))/i;
/**
 * Gambar bawaan situs (dipakai untuk SEMUA halaman sebagai cadangan og:image), mis.
 * `assets/og-default.jpg` pada situs pemda. Gambar seperti ini bukan foto berita: bila dipakai,
 * semua berita akan tampil dengan gambar yang sama — terlihat seperti kerusakan dan menyesatkan
 * pembaca. Karena itu dianggap "tidak ada gambar", dan badan artikel dicari lebih dulu.
 */
const SITE_DEFAULT_IMAGE = /(?:og[-_]?default|default[-_]?(?:og|image|share)|share[-_]?image[-_]?default|social[-_]?default)/i;

/**
 * Host yang isinya logo/ikon, bukan foto berita.
 *
 * Gejala nyata (1 Nov 2026): berita yang berasal dari Google News tampil dengan LOGO Google News
 * 300×300 (`lh3.googleusercontent.com/…`). Alamat itu tidak memuat kata "logo", jadi pola nama di
 * bawah tidak menangkapnya. Karena itu host-nya diblokir langsung.
 */
const LOGO_HOSTS = [
  'googleusercontent.com', 'gstatic.com', 'google.com', 'news.google.com', 'schema.org',
];
/** true bila alamat ini hampir pasti logo/ikon situs, bukan foto berita. */
export function isLogoImage(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = (u.pathname + u.search).toLowerCase();
    if (LOGO_HOSTS.some(h => host === h || host.endsWith('.' + h))) return true;
    // nama berkas/kelas yang menandakan logo
    return /(?:^|[/_-])(?:logo|favicon|brandmark|site-?icon)(?:[/_.-]|$)/.test(path);
  } catch { return false; }
}

function absolute(raw: string | undefined | null, base: string): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/&amp;/g, '&');
  if (!value || value.length > MAX_URL_LENGTH) return null;
  if (/^data:/i.test(value)) return null; // gambar tempelan, bukan berkas penerbit
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Urutan kepercayaan: og:image → twitter:image → link image_src → <img> pertama yang masuk akal. */
/** Kata bermakna dari judul, dipakai untuk menilai apakah `alt` gambar cocok dengan berita. */
function titleWords(title: string): string[] {
  return String(title).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4).slice(0, 14);
}

export function imageFromHtml(html: string, baseUrl: string, opts: {title?: string} = {}): string | null {
  const $ = cheerio.load(html.slice(0, 400_000));
  const metaSelectors = [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'link[rel="image_src"]',
  ];
  for (const selector of metaSelectors) {
    const el = $(selector).first();
    const found = absolute(el.attr('content') ?? el.attr('href'), baseUrl);
    // Logo situs (mis. logo Google News) bukan foto berita — lewati, jangan dipakai.
    if (!found || NOT_ARTICLE_IMAGE.test(found) || isLogoImage(found)) continue;
    // Gambar bawaan situs bukan foto berita → jangan dipakai; badan artikel dicari di bawah.
    if (SITE_DEFAULT_IMAGE.test(found)) break;
    return found;
  }
  const words = titleWords(opts.title || $('meta[property="og:title"]').attr('content') || $('title').first().text() || '');
  let best: {src: string; score: number} | null = null;
  for (const scope of ['article img', 'main img', '.post-content img', '.entry-content img', '.content img', 'img']) {
    for (const node of $(scope).toArray()) {
      const el = $(node);
      const src = absolute(el.attr('src') ?? el.attr('data-src') ?? el.attr('data-lazy-src'), baseUrl);
      if (src && isLogoImage(src)) continue;
      if (!src || NOT_ARTICLE_IMAGE.test(src) || SITE_DEFAULT_IMAGE.test(src)) continue;
      const width = Number(el.attr('width'));
      if (Number.isFinite(width) && width > 0 && width < 200) continue; // ikon kecil
      const alt = String(el.attr('alt') || '').toLowerCase();
      let score = scope === 'img' ? 0 : 2;
      if (words.length && words.some(w => alt.includes(w))) score += 3; // alt cocok judul = kuat
      if (!best || score > best.score) best = {src, score};
      if (score >= 5) return src; // sudah yakin, tidak perlu menelusuri semua gambar
    }
  }
  return best?.src ?? null;
}

/**
 * Jarak minimum antar-permintaan ke host yang sama. `10` berasal dari `Crawl-delay: 10` pada
 * robots.txt Bali Puspa News; host lain memakai nilai yang sama agar seragam dan tetap sopan.
 */
export const HOST_GAP_MS = 10_000;

async function pacing(db: Client): Promise<void> {
  await db.execute('CREATE TABLE IF NOT EXISTS hub_image_pacing_v2 (host TEXT PRIMARY KEY, last_at INTEGER NOT NULL)');
}
export async function hostReady(db: Client, host: string, now = Date.now()): Promise<boolean> {
  try {
    await pacing(db);
    const row = (await db.execute({sql: 'SELECT last_at FROM hub_image_pacing_v2 WHERE host=?', args: [host]})).rows[0];
    if (!row) return true;
    return now - Number(row.last_at) >= HOST_GAP_MS;
  } catch {
    return false; // ragu = jangan meminta
  }
}
export async function markHost(db: Client, host: string, now = Date.now()): Promise<void> {
  try {
    await pacing(db);
    await db.execute({sql: 'INSERT INTO hub_image_pacing_v2(host,last_at) VALUES(?,?) ON CONFLICT(host) DO UPDATE SET last_at=excluded.last_at', args: [host, now]});
  } catch { /* pencatatan kesopanan bersifat opsional */ }
}

/**
 * Ambil gambar utama dari halaman artikel. Tidak pernah melempar: kegagalan apa pun = `null`,
 * dan berita tetap diterbitkan seperti biasa (gambar tidak boleh menghalangi penerbitan).
 */
export async function pickImageFromPage(pageUrl: string, fetcher?: (url: string) => Promise<string>): Promise<string | null> {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'https:') return null;
    const load = fetcher ?? ((target: string) => publicFetch(target, 900_000));
    await checkRobots(pageUrl);
    const html = await load(pageUrl);
    if (!/<html|<!doctype/i.test(html.slice(0, 2000))) return null;
    const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || '';
    return imageFromHtml(html, pageUrl, {title});
  } catch {
    return null;
  }
}

/**
 * Ganti gambar yang telanjur tersimpan sebagai LOGO dengan foto asli dari halaman artikel.
 *
 * Gejala nyata: berita dari Google News terbit dengan logo Google News 300×300. Penjagaan
 * `isLogoImage` mencegahnya terulang, tetapi baris lama di database tetap menyimpan logo itu.
 * Fungsi ini membersihkannya: logo dibuang, foto asli diambil ulang, dan bila tidak ada foto
 * asli, kolomnya dikosongkan supaya portal menampilkan gambar netral — bukan logo Google.
 */
export async function reclaimLogoImages(
  db: Client,
  opts: {limit?: number; fetcher?: (url: string) => Promise<string>; now?: number} = {},
): Promise<{checked: number; cleared: number; repaired: number}> {
  const out = {checked: 0, cleared: 0, repaired: 0};
  const limit = Math.max(1, Math.min(40, opts.limit ?? 12));
  let rows: {id: unknown; original_url: unknown; source_image_url: unknown}[] = [];
  try {
    rows = (await db.execute({
      sql: `SELECT id,original_url,source_image_url FROM hub_items
            WHERE source_image_url IS NOT NULL AND source_image_url<>''
              AND (source_image_url LIKE '%googleusercontent.com%' OR source_image_url LIKE '%gstatic.com%'
                   OR source_image_url LIKE '%news.google.com%' OR lower(source_image_url) LIKE '%logo%')
            ORDER BY julianday(source_published_at) DESC LIMIT ?`,
      args: [limit],
    })).rows as unknown as typeof rows;
  } catch { return out; }
  out.checked = rows.length;
  for (const row of rows) {
    const current = String(row.source_image_url || '');
    if (!isLogoImage(current)) continue; // sudah bukan logo — biarkan
    const pageUrl = String(row.original_url || '');
    let replacement: string | null = null;
    if (/^https:\/\//i.test(pageUrl)) {
      replacement = await pickImageFromPage(pageUrl, opts.fetcher).catch(() => null);
      if (replacement && isLogoImage(replacement)) replacement = null;
    }
    if (replacement) {
      await db.execute({sql: 'UPDATE hub_items SET source_image_url=? WHERE id=?', args: [replacement, String(row.id)]});
      out.repaired++;
    } else {
      await db.execute({sql: "UPDATE hub_items SET source_image_url=NULL WHERE id=?", args: [String(row.id)]});
      out.cleared++;
    }
  }
  return out;
}
