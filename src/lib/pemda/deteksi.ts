/**
 * DETEKSI PEMDA — menentukan artikel ini membahas pemerintah daerah yang mana.
 *
 * Kenapa modul terpisah: deteksi wilayah yang lama (`src/config/regions.ts`) mencocokkan nama
 * daerah begitu saja, sehingga "Bima Arya" (Wali Kota Bogor) masuk ke wilayah Bima, dan
 * "Sumbawa" ikut tertangkap saat artikelnya tentang "Sumbawa Barat". Kesalahan ini terbukti di
 * produksi: halaman /wilayah/bima memuat berita Sumatera Barat.
 *
 * ATURAN (diuji di tests/hub-pemda-deteksi.test.ts):
 *  1. "Bima" TELANJANG tidak dihitung. Harus ada kota/pemkot/kabupaten/pemkab/bupati/wali kota
 *     di depannya — karena Bima juga nama orang yang lazim.
 *  2. "Sumbawa" dibedakan dari "Sumbawa Barat" memakai lookahead negatif.
 *  3. "Mataram" boleh telanjang (nama kota, tidak ambigu), tetapi tidak boleh tertangkap dari
 *     kata "ANTARA Mataram" pada nama media — lihat KECUALI_SUMBER.
 *  4. Tidak ada satu pun jaringan yang dipanggil di sini; fungsi ini murni pencocokan teks.
 */

/** Nama orang yang memakai nama daerah — jangan pernah dianggap wilayah. */
const BUKAN_WILAYAH = [
  /\bbima\s+arya\b/i,
  /\bbima\s+sakti\b/i,
  /\blombok\s+post\b/i, // nama media, bukan berita daerah
];

export type PemdaId =
  | 'ntb-provinsi' | 'lombok-barat' | 'lombok-tengah' | 'lombok-timur' | 'lombok-utara'
  | 'mataram' | 'sumbawa' | 'sumbawa-barat' | 'dompu' | 'kabupaten-bima' | 'kota-bima';

type Aturan = { id: PemdaId; nama: string; pola: RegExp };

export const PEMDA: Aturan[] = [
  { id: 'ntb-provinsi', nama: 'Provinsi NTB',
    pola: /\b(pemprov|pemda|gubernur|wagub|sekda)\s+(ntb|nusa\s+tenggara\s+barat)\b|\bprovinsi\s+(ntb|nusa\s+tenggara\s+barat)\b/i },
  { id: 'lombok-barat', nama: 'Lombok Barat', pola: /\blombok\s+barat\b|\blobar\b/i },
  { id: 'lombok-tengah', nama: 'Lombok Tengah', pola: /\blombok\s+tengah\b|\bloteng\b/i },
  { id: 'lombok-timur', nama: 'Lombok Timur', pola: /\blombok\s+timur\b|\blotim\b/i },
  { id: 'lombok-utara', nama: 'Lombok Utara', pola: /\blombok\s+utara\b|\bKLU\b/i },
  // "Mataram" tanpa prefiks diizinkan karena tidak ambigu sebagai nama orang.
  { id: 'mataram', nama: 'Kota Mataram', pola: /\b(kota|pemkot)\s+mataram\b|\bwali\s?kota\s+mataram\b|\bmataram\b/i },
  // "Sumbawa" sah, tetapi BUKAN bila diikuti "Barat".
  { id: 'sumbawa', nama: 'Sumbawa', pola: /\bsumbawa\b(?!\s*barat)/i },
  { id: 'sumbawa-barat', nama: 'Sumbawa Barat', pola: /\bsumbawa\s+barat\b|\bKSB\b|\btaliwang\b/i },
  { id: 'dompu', nama: 'Dompu', pola: /\bdompu\b/i },
  { id: 'kabupaten-bima', nama: 'Kabupaten Bima', pola: /\bkabupaten\s+bima\b|\bpemkab\s+bima\b|\bbupati\s+bima\b/i },
  { id: 'kota-bima', nama: 'Kota Bima', pola: /\bkota\s+bima\b|\bpemkot\s+bima\b|\bwali\s?kota\s+bima\b/i },
];

export type HasilDeteksi = {
  /** Id pemda yang benar-benar disebut, urut sesuai daftar PEMDA. */
  pemda: PemdaId[];
  /** Subjek utama: pemda pertama yang disebut (untuk pengelompokan halaman). */
  utama: PemdaId | null;
  /** Apakah teks memuat penanda instansi pemerintah (bupati, dinas, sekda, …). */
  rilis: boolean;
};

const PENANDA_RILIS = /\b(pemprov|pemkab|pemkot|pemda|setda|sekda|bupati|wakil\s+bupati|wakil\s+wali|wali\s?kota|walikota|gubernur|dinas|diskominfo|diskominfotik|kominfotik|prokopim|bpbd|dprd|inspektorat|bappeda|ppid)\b/i;

/**
 * Deteksi pemda dari judul + ringkasan.
 * Mengembalikan daftar KOSONG bila tidak ada pemda yang jelas disebut — lebih baik kosong
 * daripada salah menempelkan artikel ke halaman daerah yang salah.
 */
export function deteksiPemda(judul: string, ringkasan = ''): HasilDeteksi {
  const teks = `${judul || ''} ${ringkasan || ''}`.replace(/\s+/g, ' ').trim();
  if (!teks) return { pemda: [], utama: null, rilis: false };

  // Buang nama orang lebih dulu supaya "Bima Arya" tidak ikut terhitung.
  let bersih = teks;
  for (const pola of BUKAN_WILAYAH) bersih = bersih.replace(pola, ' ');

  const pemda = PEMDA.filter((a) => a.pola.test(bersih)).map((a) => a.id);
  return { pemda, utama: pemda[0] ?? null, rilis: PENANDA_RILIS.test(teks) };
}

/** Versi ringkas: hanya daftar id. */
export function pemdaDari(judul: string, ringkasan = ''): PemdaId[] {
  return deteksiPemda(judul, ringkasan).pemda;
}
