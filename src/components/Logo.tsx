'use client';
import { useState } from 'react';

/**
 * Logo portal.
 *
 * SEBELUMNYA komponen ini memeriksa keberadaan berkas lewat `existsSync` di server. Itu gagal
 * di produksi: halaman yang dirender ulang (ISR) berjalan di fungsi serverless Vercel, di mana
 * folder `public/` tidak selalu ada di sistem berkas fungsi — sehingga pemeriksaan menjawab
 * "tidak ada" dan yang tampil selalu kotak huruf, padahal berkasnya jelas terunggah.
 *
 * Sekarang tidak ada pemeriksaan sistem berkas sama sekali. Gambar SELALU dirender; bila gagal
 * dimuat (berkas belum ada / nama salah), barulah kotak huruf ditampilkan lewat `onError`.
 * Hasilnya sama di build, di serverless, dan di komputer sendiri.
 */
export default function Logo({ size = 40, name = 'portal-hub', file }: { size?: number; name?: string; file?: string }) {
  const src = `/${file || process.env.NEXT_PUBLIC_SITE_LOGO || 'logo.png'}`.replace(/^\/+/, '/');
  const [gagal, setGagal] = useState(false);
  const huruf = (name || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <span className="flex shrink-0 items-center gap-2.5 font-serif text-3xl font-bold tracking-tight text-brand">
      {gagal ? (
        <span className="grid place-items-center rounded-lg bg-brand text-bg" style={{ height: size, width: size, fontSize: size * 0.6 }} aria-hidden>
          {huruf}
        </span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={name}
          onError={() => setGagal(true)}
          className={`block w-auto shrink-0 object-contain ${size >= 40 ? 'h-8 sm:h-10' : 'h-7 sm:h-8'}`}
        />
      )}
    </span>
  );
}
