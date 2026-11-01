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
export function imageFromHtml(html: string, baseUrl: string): string | null {
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
    if (found && !NOT_ARTICLE_IMAGE.test(found)) return found;
  }
  const scopes = ['article img', 'main img', '.post-content img', '.entry-content img', '.content img', 'img'];
  for (const scope of scopes) {
    const candidates = $(scope).toArray();
    for (const node of candidates) {
      const el = $(node);
      const src = absolute(el.attr('src') ?? el.attr('data-src') ?? el.attr('data-lazy-src'), baseUrl);
      if (!src || NOT_ARTICLE_IMAGE.test(src)) continue;
      const width = Number(el.attr('width'));
      if (Number.isFinite(width) && width > 0 && width < 200) continue; // ikon kecil
      return src;
    }
  }
  return null;
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
    return imageFromHtml(html, pageUrl);
  } catch {
    return null;
  }
}
