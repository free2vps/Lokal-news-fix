/**
 * Penyadur tautan pemda → DRAF (bukan terbit otomatis).
 *
 * Yang diambil hanya: judul, tanggal terbit, gambar utama, alamat gambar, dan beberapa
 * kalimat pertama. Yang keluar BUKAN artikel tulis ulang: ringkasan pendek + atribusi +
 * tautan asli. Alasannya dua:
 *  1) Hak cipta — teks utuh milik pemda; kita tidak menyalin seluruh isi.
 *  2) Brief §5 — parafrase artikel dengan AI dilarang; ringkasan harus berasal dari kalimat
 *     asli sumber, bukan karangan. Karena itu tidak ada AI di jalur ini sama sekali.
 *
 * Situs yang memasang tembok anti-bot (Cloudflare/CAPTCHA) → gagal dengan pesan jelas.
 * Tidak ada upaya menembus, tidak ada penyamaran sebagai browser.
 */

const AGEN = 'PortalHubBot/1.0 (+https://portal-hub.online)';
const MAKS_HTML = 2_500_000;

export type Saduran = {
  judul: string; ringkasan: string; tanggal: string | null; gambar_url: string | null;
  sumber_nama: string; sumber_url: string;
};

export type GagalSadur = { kode: string; pesan: string };

const bersih = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  // Entitas tipografi yang lazim di situs pemda (&ndash;, &mdash;, &hellip;, &rsquo;, &eacute; …).
  .replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—').replace(/&hellip;/gi, '…')
  .replace(/&rsquo;|&lsquo;/gi, "'").replace(/&rdquo;|&ldquo;/gi, '"')
  .replace(/&#(\d+);/g, (_m, kode) => String.fromCodePoint(Number(kode)))
  .replace(/&#x([0-9a-f]+);/gi, (_m, kode) => String.fromCodePoint(parseInt(kode, 16)))
  .replace(/&(?:[a-z][a-z0-9]*);/gi, '')
  .replace(/\s+/g, ' ').trim();

function isi(html: string, pola: RegExp) {
  const m = html.match(pola);
  return m ? bersih(m[1]) : '';
}

/** Kalimat utuh saja — tidak memotong di tengah kata/kalimat. */
export function ambilKalimat(teks: string, maksimal = 420, jumlahKalimat = 4) {
  const kalimat = teks.split(/(?<=[.!?])\s+/).filter((k) => k.trim().length > 25);
  const dipilih: string[] = [];
  let panjang = 0;
  for (const k of kalimat) {
    if (dipilih.length >= jumlahKalimat || panjang + k.length > maksimal) break;
    dipilih.push(k.trim());
    panjang += k.length + 1;
  }
  return dipilih.join(' ');
}

export function bacaTanggal(html: string): string | null {
  const calon = [
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i)?.[1],
    html.match(/<meta[^>]+name=["'](?:publishdate|pubdate|date|DC.date.issued)["'][^>]+content=["']([^"']+)/i)?.[1],
    html.match(/<time[^>]+datetime=["']([^"']+)/i)?.[1],
  ].filter(Boolean) as string[];
  for (const c of calon) {
    const t = Date.parse(c);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

/** Nama penerbit dari judul situs / og:site_name, bukan dari domain (lebih jujur ke pembaca). */
export function bacaNamaSumber(html: string, alamat: string) {
  const nama = isi(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)
    || isi(html, /<title[^>]*>([\s\S]*?)<\/title>/i).split(/\s+[|–—-]\s+/).pop()
    || '';
  if (nama && nama.length <= 80) return nama;
  return new URL(alamat).hostname.replace(/^www\./, '');
}

/** Ubah ke kata-kata saja: huruf kecil, tanpa tanda baca. */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Buang awalan/akhiran nama situs dari judul ("Situs Kabupaten – Judul" → "Judul").
 *
 * HANYA memotong kalau judul benar-benar punya pemisah ("-", "|", "–", ":", "•") — itu
 * tanda kuat bahwa awalan/akhirannya memang nama situs, bukan bagian berita. Judul yang
 * kebetulan menyebut daerah ("APBD Sumbawa Barat 2027") tidak dipotong.
 */
export function bersihkanJudul(judul: string, namaSitus: string) {
  const asli = judul.trim();
  if (!asli) return asli;
  const bagian = asli.split(/\s*[|–—•:]\s*|\s+-\s+/).filter((b) => b.trim());
  if (bagian.length < 2) return asli;
  const kunci = [...new Set(norm(namaSitus).split(' ').filter((k) => k.length > 2))];
  if (!kunci.length) return asli;
  const miripSitus = (teks: string) => {
    const kata = norm(teks).split(' ');
    if (kata.length > 6 || kata.length < kunci.length) return false;
    const cocok = kunci.filter((k) => kata.includes(k)).length;
    return cocok >= Math.min(2, kunci.length);
  };
  const sisa = [...bagian];
  if (miripSitus(sisa[0])) sisa.shift();
  if (sisa.length > 1 && miripSitus(sisa[sisa.length - 1])) sisa.pop();
  const hasil = sisa.join(' - ').trim();
  // Sisa harus masih layak jadi judul; kalau tidak, kembalikan judul apa adanya.
  return hasil.length >= 15 ? hasil : asli;
}

export function bacaTanggalTeks(teks: string): string | null {
  // Angka: 9/11/2026 atau 9-11-2026 (hari/bulan/tahun, gaya Indonesia).
  const angka = teks.match(/(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{4})/);
  if (angka) {
    const [, d, m, y] = angka;
    const t = Date.parse(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  // Kata: "9 November 2026".
  const kata = teks.match(/(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i);
  if (kata) {
    const indeks = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'].indexOf(kata[2].toLowerCase());
    if (indeks >= 0) return new Date(Date.UTC(Number(kata[3]), indeks, Number(kata[1]))).toISOString();
  }
  return null;
}

export function sadurHtml(html: string, alamat: string): Saduran | GagalSadur {
  const judul = isi(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)
    || isi(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
    || isi(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!judul) return { kode: 'JUDUL_TIDAK_ADA', pesan: 'Halaman itu tidak memuat judul yang bisa dibaca (mungkin isinya dijalankan oleh JavaScript).' };

  // Isi utama: artikel → main → article; kalau tidak ada, seluruh paragraf.
  const wadah = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  const paragraf = [...wadah.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => bersih(m[1]))
    .filter((t) => t.length > 60);
  const ringkasan = ambilKalimat(paragraf.join(' '));
  if (!ringkasan) return { kode: 'ISI_TIDAK_ADA', pesan: 'Halaman itu tidak memuat paragraf isi yang bisa diringkas (mungkin isinya dijalankan oleh JavaScript).' };

  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]?.trim();
  let gambar: string | null = null;
  if (ogImage) { try { const u = new URL(ogImage, alamat); if (u.protocol === 'https:') gambar = u.href; } catch { /* tanpa gambar */ } }

  const namaSumber = bacaNamaSumber(html, alamat);
  // Tanggal: meta dulu (paling bisa dipercaya), baru teks terlihat bila tidak ada meta.
  const sekarang = Date.now();
  const dariTeks = bacaTanggalTeks(`${judul} ${paragraf.slice(0, 3).join(' ')}`);
  const tanggal = bacaTanggal(html) ?? (dariTeks && Date.parse(dariTeks) <= sekarang + 86_400_000 ? dariTeks : null);
  return { judul: bersihkanJudul(judul, namaSumber).slice(0, 240), ringkasan, tanggal, gambar_url: gambar, sumber_nama: namaSumber, sumber_url: alamat };
}

/** Tembok anti-bot yang lazim: dikenali dari kode status + penanda di halaman. */
function tembokAntiBot(status: number, html: string): GagalSadur | null {
  const tanda = /just a moment|checking your browser|cf-browser-verification|_cf_chl_opt|attention required|recaptcha|are you a robot/i.test(html);
  if (tanda) return { kode: 'ANTI_BOT', pesan: 'Situs itu memasang pemeriksaan anti-bot. Portal tidak menembusnya; salin isinya secara manual bila perlu.' };
  if ([401, 403, 429, 503].includes(status)) return { kode: 'DITOLAK_SUMBER', pesan: `Sumber menolak permintaan (HTTP ${status}).` };
  return null;
}

/** Ambil halaman lalu sadur. Pemanggil WAJIB memeriksa robots.txt lebih dulu. */
export async function sadurTautan(alamat: string, fetcher: typeof fetch = fetch): Promise<Saduran | GagalSadur> {
  let url: URL;
  try { url = new URL(alamat); } catch { return { kode: 'ALAMAT_TIDAK_SAH', pesan: 'Alamat tautan tidak sah.' }; }
  if (url.protocol !== 'https:' || url.username || url.password) return { kode: 'ALAMAT_TIDAK_SAH', pesan: 'Hanya alamat https biasa yang diterima.' };
  let res: Response;
  try {
    res = await fetcher(url.href, {
      redirect: 'follow', signal: AbortSignal.timeout(15000), cache: 'no-store',
      headers: { 'user-agent': AGEN, accept: 'text/html,application/xhtml+xml' },
    });
  } catch {
    return { kode: 'TIDAK_TERHUBUNG', pesan: 'Sumber tidak menjawab (jaringan/timeout). Coba lagi nanti atau salin manual.' };
  }
  const tipe = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(tipe)) return { kode: 'BUKAN_HALAMAN', pesan: 'Alamat itu bukan halaman artikel (bukan HTML).' };
  const html = (await res.text().catch(() => '')).slice(0, MAKS_HTML);
  const tembok = tembokAntiBot(res.status, html);
  if (tembok) return tembok;
  if (!res.ok) return { kode: 'GAGAL_AMBIL', pesan: `Halaman gagal diambil (HTTP ${res.status}).` };
  return sadurHtml(html, url.href);
}
