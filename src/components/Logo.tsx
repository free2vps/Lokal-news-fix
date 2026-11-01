import { existsSync } from 'node:fs';
import path from 'node:path';
import { SITE } from '@/config/site';

/**
 * Logo portal.
 *
 * Memakai berkas gambar bila memang ada di `public/`, dan jatuh kembali ke kotak huruf
 * pertama bila belum — supaya tidak pernah muncul gambar rusak (ikon patah) saat berkas
 * belum diunggah. Dua lokasi dicari, urut:
 *   1. public/logo.png   (isi via NEXT_PUBLIC_SITE_LOGO)
 *   2. kotak huruf       (cadangan)
 *
 * Berkas SVG sengaja tidak dipakai langsung agar teks alternatif tetap terbaca pembaca layar.
 */
function logoExists(file: string): boolean {
  try {
    return existsSync(path.join(process.cwd(), 'public', file));
  } catch {
    return false;
  }
}

/** Apakah berkas logo benar-benar ada. Dipakai komponen lain agar tidak menulis nama dua kali. */
export const HAS_LOGO = logoExists((process.env.NEXT_PUBLIC_SITE_LOGO || 'logo.png').replace(/^\/+/, ''));

export default function Logo({ size = 40, withName = true }: { size?: number; withName?: boolean }) {
  const candidate = (process.env.NEXT_PUBLIC_SITE_LOGO || 'logo.png').replace(/^\/+/, '');
  const has = logoExists(candidate);

  return (
    <span className="flex items-center gap-2.5 font-serif text-3xl font-bold tracking-tight text-brand">
      {has ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/${candidate}`}
          alt={SITE.name}
          height={size}
          style={{ height: size, width: 'auto' }}
          className="block"
        />
      ) : (
        <span className="grid place-items-center rounded-lg bg-brand text-bg" style={{ height: size, width: size, fontSize: size * 0.6 }} aria-hidden>
          {SITE.name[0]}
        </span>
      )}
      {withName && has && <span className="sr-only">{SITE.name}</span>}
      {withName && !has && <span className="hidden sm:inline">{SITE.name}</span>}
    </span>
  );
}
