import {regionName} from '@/config/regions';

/**
 * Penyusun hashtag untuk kiriman media sosial.
 *
 * Aturan yang dipegang (keputusan pemilik 12 Nov 2026):
 *  1. Hashtag UTAMA selalu berasal dari isi berita sendiri: wilayah, kategori, lalu tag.
 *     Ini selalu relevan dan tidak bergantung pada pihak ketiga.
 *  2. Hashtag TREN (Google Trends / tren X) hanya dipakai SATU, dan hanya bila kata
 *     terpenting dari tren itu benar-benar muncul di judul atau ringkasan berita.
 *     Menempelkan tren yang tidak nyambung = spam; Facebook justru menurunkan jangkauan.
 *  3. Maksimal 3 tag. Tidak ada data karangan: bila tidak ada yang cocok, tagnya lebih sedikit.
 */

/** Kata umum yang tidak boleh sendirian memicu kecocokan tren. */
const UMUM = new Set([
  'yang', 'dari', 'untuk', 'dengan', 'pada', 'dalam', 'akan', 'telah', 'bisa', 'oleh', 'karena',
  'juga', 'ini', 'itu', 'dan', 'atau', 'jika', 'saat', 'hari', 'tahun', 'pekan', 'minggu',
  'bulan', 'para', 'agar', 'setelah', 'sebelum', 'tentang', 'kepada', 'dalam', 'lagi', 'sudah',
  'sedang', 'belum', 'masih', 'saja', 'pun', 'nya', 'dia', 'mereka', 'kami', 'kita', 'anda',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'akan', 'presiden', 'viral',
]);

/** Ubah teks bebas menjadi satu hashtag: "Sumbawa Barat" → "#SumbawaBarat". */
export function tag(teks: string, maksKata = 4): string | null {
  if (!teks) return null;
  const kata = teks.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(Boolean).slice(0, maksKata)
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1));
  if (!kata.length) return null;
  const gabung = kata.join('');
  if (gabung.length < 3 || gabung.length > 30) return null;
  if (!/[\p{L}]/u.test(gabung)) return null;
  return '#' + gabung;
}

/** Kata terpenting dari sebuah tren: kata terpanjang yang tidak umum. */
export function kataKunciTren(tren: string): string | null {
  const kata = tren.replace(/^#/, '').normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase()
    .split(/\s+/).filter((k) => k.length >= 4 && !UMUM.has(k));
  if (!kata.length) return null;
  return kata.sort((a, b) => b.length - a.length)[0];
}

/** Apakah kata ini muncul utuh di dalam teks (bukan sebagai potongan kata lain)? */
function utuh(teks: string, kata: string) {
  const batas = '[\\s\\p{P}\\p{S}]|^|$';
  return new RegExp(`(^|[\\s\\p{P}\\p{S}])${kata.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\p{P}\\p{S}]|$)`, 'u').test(teks);
}

/** Cari tren yang benar-benar muncul di berita. Mengembalikan teks trennya, atau null. */
export function cariTren(teksBerita: string, tren: string[]): string | null {
  const teks = teksBerita.toLowerCase();
  for (const t of tren) {
    const kunci = kataKunciTren(t);
    if (kunci && utuh(teks, kunci)) return t;
  }
  return null;
}

export type SumberTag = {
  judul: string; ringkasan?: string | null; wilayah?: string | null;
  kategori?: string | null; tag?: string[] | null;
};

/**
 * Susun hashtag untuk satu berita. `tren` diisi daftar teks tren yang sedang naik
 * (sudah terurut menurut peringkat). Aman dipanggil dengan daftar kosong.
 */
export function susunHashtag(sumber: SumberTag, tren: string[] = [], maks = 3): string[] {
  const hasil: string[] = [];
  const punya = (h: string) => hasil.some((x) => x.toLowerCase() === h.toLowerCase());
  const tambah = (nilai?: string | null) => {
    if (!nilai || hasil.length >= maks) return;
    const h = tag(nilai);
    if (h && !punya(h)) hasil.push(h);
  };
  const teks = `${sumber.judul} ${sumber.ringkasan ?? ''}`.toLowerCase();
  const trenCocok = tren.length ? cariTren(teks, tren) : null;

  // Satu slot dicadangkan untuk tren bila ada yang cocok.
  const batasIsi = Math.max(0, maks - (trenCocok ? 1 : 0));
  tambah(regionName(sumber.wilayah) ?? sumber.wilayah);
  if (hasil.length < batasIsi) tambah(sumber.kategori);
  for (const t of sumber.tag ?? []) { if (hasil.length >= batasIsi) break; tambah(t); }
  if (trenCocok) tambah(trenCocok);
  return hasil.slice(0, maks);
}

/** Baris tag siap tempel: "#SumbawaBarat #InfoPemda". */
export function barisTag(daftar: string[]) { return daftar.join(' '); }
