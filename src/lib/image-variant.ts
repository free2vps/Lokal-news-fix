/**
 * Gambar sumber sering tersimpan dalam ukuran kecil, misalnya
 * `https://cdn.penerbit/.../foto_169.jpeg?w=360&q=90` — hanya 360×203 piksel.
 *
 * Facebook, WhatsApp, dan X memutuskan bentuk kartu berbagi dari ukuran gambar sebenarnya:
 *   - ≥ 600×315  → kartu BESAR (gambar selebar postingan)
 *   - < 600 px   → kartu KECIL (gambar mungil di kiri, teks di kanan)
 *
 * Jadi dua artikel yang sama-sama berbagi tautan portal bisa tampil berbeda hanya karena
 * CDN sumbernya memberi ukuran berbeda. Rujukan: rekomendasi Meta untuk gambar tautan
 * adalah 1200×630 (minimum 600×315).
 *
 * Yang dilakukan fungsi ini: meminta VARIAN BESAR dari URL yang sama. Tidak menyalin,
 * tidak menyimpan ulang, tidak mengubah gambar — hanya parameter ukuran pada URL penerbit.
 * Kalau URL tidak punya parameter ukuran yang dikenali, URL dibiarkan apa adanya.
 */

const PARAM_UKURAN = ['w', 'width', 'maxwidth', 'mw', 'size'];
export const UKURAN_KARTU_BESAR = 1200;

export type GambarBesar = { url: string; dinaikkan: boolean; faktor: number };

export function largeImage(url: string | null | undefined, target = UKURAN_KARTU_BESAR): GambarBesar {
  const asli = String(url || '').trim();
  if (!/^https:\/\//i.test(asli)) return { url: asli, dinaikkan: false, faktor: 1 };
  let u: URL;
  try { u = new URL(asli); } catch { return { url: asli, dinaikkan: false, faktor: 1 }; }

  let dinaikkan = false;
  let faktor = 1;
  for (const k of PARAM_UKURAN) {
    const v = u.searchParams.get(k);
    if (!v || !/^\d+$/.test(v)) continue;
    const angka = Number(v);
    // Hanya menaikkan; jangan pernah memperkecil gambar yang sudah besar.
    if (angka > 0 && angka < target) {
      u.searchParams.set(k, String(target));
      faktor = target / angka;
      dinaikkan = true;
    }
  }
  return dinaikkan ? { url: u.toString(), dinaikkan, faktor } : { url: asli, dinaikkan: false, faktor: 1 };
}

/**
 * Ukuran yang dideklarasikan ke mesin pencari/media sosial.
 * Kalau URL dinaikkan tetapi lebar/tinggi tetap ukuran lama, Facebook tetap menganggap
 * gambarnya kecil — jadi angkanya ikut diskalakan.
 */
export function ukuranGambar(
  url: string | null | undefined,
  width: number | null | undefined,
  height: number | null | undefined,
): { url: string; width?: number; height?: number } {
  const hasil = largeImage(url);
  const dasar = { url: hasil.url };
  if (!width || !height) return dasar;
  const lebar = Math.round(width * hasil.faktor);
  const tinggi = Math.round(height * hasil.faktor);
  if (!Number.isFinite(lebar) || !Number.isFinite(tinggi) || lebar <= 0 || tinggi <= 0) return dasar;
  return { ...dasar, width: lebar, height: tinggi };
}

/** Bernilai benar bila gambar layak untuk kartu besar (dipakai untuk peringatan di panel). */
export function layakKartuBesar(width: number | null | undefined, height: number | null | undefined) {
  return Boolean(width && height && width >= 600 && height >= 315);
}

/**
 * Ukuran yang dipakai tiap tempat di portal. Satu sumber gambar bisa dipakai untuk
 * beberapa tempat sekaligus, jadi targetnya dibedakan:
 *   hero/artikel 1200 → tampil lebar, wajib tajam
 *   kartu        800  → tampil ~300–400 px, cukup tajam di layar retina
 *   baris kecil   480  → tampil < 200 px
 * Jangan pernah menurunkan: URL yang sudah besar dibiarkan.
 */
export const UKURAN_TAMPIL = { hero: 1200, kartu: 800, baris: 480 } as const;

export function imgSrc(url: string | null | undefined, target: number = UKURAN_TAMPIL.kartu): string {
  return largeImage(url, target).url;
}
