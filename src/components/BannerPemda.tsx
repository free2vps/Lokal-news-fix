import type { Banner } from '@/lib/queries';

/**
 * Slot tetap "Pengumuman" di beranda (pilihan A yang dipilih pemilik).
 *
 * Aturan yang dipegang:
 *  • WAJIB berlabel. Ini iklan/pengumuman berbayar dari pemda — iklan tanpa label adalah
 *    iklan gelap, melanggar etika dan merugikan pemilik bila ada sengketa.
 *  • `rel="sponsored nofollow"` — tautan berbayar tidak boleh diteruskan sebagai sinyal SEO
 *    (kebijakan Google tentang tautan berbayar).
 *  • Gambar tidak disalin atau diunggah ulang; hanya alamatnya yang ditampilkan.
 *  • Kalau tidak ada banner aktif, komponen mengembalikan null — tidak ada kotak kosong.
 */
export default function BannerPemda({ banner }: { banner: Banner | null }) {
  if (!banner) return null;
  const isi = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={banner.gambar_url}
      alt={banner.judul}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="h-auto w-full rounded-lg object-cover"
    />
  );
  return (
    <section aria-label="Pengumuman pemerintah daerah" className="rounded-2xl border border-line/70 bg-surface p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Pengumuman</p>
      {banner.tautan
        ? <a href={banner.tautan} target="_blank" rel="sponsored nofollow noopener" className="block">{isi}</a>
        : isi}
      <p className="mt-2 text-sm font-semibold leading-snug">{banner.judul}</p>
    </section>
  );
}
