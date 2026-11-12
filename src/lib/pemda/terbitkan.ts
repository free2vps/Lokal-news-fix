import {createHash} from 'node:crypto';
import {slugify} from '@/lib/utils';
import {detectRegion} from '@/config/regions';
import {deteksiPemda} from '@/lib/pemda/deteksi';

/** PemdaId → slug wilayah yang dipakai kolom `articles.region` (lihat src/config/regions.ts). */
const PEMDA_KE_WILAYAH: Record<string, string> = {
  'ntb-provinsi': 'ntb', 'lombok-barat': 'lombok-barat', 'lombok-tengah': 'lombok-tengah',
  'lombok-timur': 'lombok-timur', 'lombok-utara': 'lombok-utara', mataram: 'mataram',
  sumbawa: 'sumbawa', 'sumbawa-barat': 'sumbawa-barat', dompu: 'dompu',
  'kabupaten-bima': 'bima', 'kota-bima': 'bima',
};

export type DrafSumber = {
  judul: string; ringkasan: string; sumber_url: string; sumber_nama: string;
  tanggal_sumber?: string | null; gambar_url?: string | null;
};

export type SiapTerbit = {
  slug: string; judul: string; ringkasan: string; terbit: string;
  wilayah: string; pemda: string[]; gambar_url: string | null; sumber_nama: string; sumber_url: string;
};

/**
 * Menyiapkan satu draf menjadi baris artikel.
 *
 * Dipisah dari route agar bisa diuji langsung. Dua aturan yang tidak boleh dilanggar:
 *  1. Judul tidak pernah jadi "undefined" — bila panel tidak mengirim judul suntingan,
 *     judul draf yang dipakai; bila tetap tidak layak, proses ditolak (bukan terbit rusak).
 *  2. Tanggal tidak pernah dikarang — tanggal sumber dipakai apa adanya; hanya bila sumber
 *     tidak mencantumkan tanggal sama sekali, waktu persetujuan yang dipakai.
 */
export function siapkanTerbit(
  draf: DrafSumber,
  suntingan?: unknown,
  sekarang = Date.now(),
): {ok: true; nilai: SiapTerbit} | {ok: false; pesan: string} {
  const diminta = typeof suntingan === 'string' ? suntingan.trim() : '';
  // Judul suntingan yang "berisi" tapi bukan judul (undefined/null/terlalu pendek) juga
  // dianggap tidak ada → jatuh ke judul draf, bukan disimpan apa adanya.
  const layak = (t: string) => t.length >= 10 && !/\bundefined\b|\bnull\b/i.test(t);
  const judul = (layak(diminta) ? diminta : String(draf.judul ?? '')).trim().slice(0, 200);
  if (!judul || judul.length < 10 || /\bundefined\b/i.test(judul) || /^null$/i.test(judul))
    return {ok: false, pesan: 'Judul draf tidak terbaca. Buka ulang drafnya lalu setujui lagi; bila tetap gagal, sunting judulnya.'};

  const sumber_url = String(draf.sumber_url ?? '').trim();
  if (!sumber_url) return {ok: false, pesan: 'Alamat sumber draf tidak ada.'};

  const dasar = slugify(judul).slice(0, 70) || 'pengumuman-pemda';
  const slug = `${dasar}-pemda-${createHash('sha256').update(sumber_url).digest('hex').slice(0, 12)}`;

  const ringkasan = String(draf.ringkasan ?? '').slice(0, 700);
  const sumberNama = String(draf.sumber_nama ?? '').trim() || new URL(sumber_url).hostname.replace(/^www\./, '');
  const isi = `${ringkasan}\n\nSumber: ${sumberNama} — ${sumber_url}\nRingkasan dari pengumuman resmi; isi lengkap ada di tautan sumber.`;

  // Wilayah: `deteksiPemda` lebih dulu karena ia membedakan "Sumbawa Barat" dari "Sumbawa",
  // sedangkan `detectRegion` (yang dipakai pipeline berita) masih mengembalikan "sumbawa"
  // untuk teks yang menyebut Sumbawa Barat.
  const pemda = deteksiPemda(judul, ringkasan).pemda;
  const wilayah = PEMDA_KE_WILAYAH[pemda[0] as keyof typeof PEMDA_KE_WILAYAH]
    ?? detectRegion(`${judul} ${ringkasan}`) ?? 'ntb';

  const tanda = draf.tanggal_sumber ? Date.parse(String(draf.tanggal_sumber)) : NaN;
  const terbit = Number.isFinite(tanda) ? new Date(tanda).toISOString() : new Date(sekarang).toISOString();

  return {
    ok: true,
    nilai: {
      slug, judul,
      ringkasan: isi.slice(0, 1000),
      terbit,
      wilayah, pemda,
      gambar_url: draf.gambar_url ?? null,
      sumber_nama: sumberNama,
      sumber_url,
    },
  };
}
