import {imgSrc, UKURAN_TAMPIL} from '@/lib/image-variant';
import Link from 'next/link';
import type { Article } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

/**
 * Kartu berita bergambar.
 *
 * Dua bentuk:
 *  - `compact` (dipakai tiga kartu di bawah carousel): kategori + sumber MENUMPUK di gambar,
 *    judul di BAWAH gambar. Alasannya: di kartu sempit, judul tiga baris yang menumpuk di atas
 *    gambar menutupi hampir seluruh foto dan sulit dibaca.
 *  - bentuk biasa (lead/hiburan/kategori): judul tetap di atas gambar karena kartunya lebar.
 */
export default function HeroCard({ a, size = 'lg', compact = false }: { a: Article; size?: 'lg' | 'sm'; compact?: boolean }) {
  if (compact) return <CompactCard a={a} />;

  return (
    <article className="group relative overflow-hidden rounded-xl bg-brand">
      <Link href={`/berita/${a.slug}`} className={`block ${size === 'lg' ? 'aspect-[16/10]' : 'aspect-[4/3]'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.image_url && <img src={imgSrc(a.image_url, UKURAN_TAMPIL.hero)} alt="" loading={size === 'lg' ? 'eager' : 'lazy'} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover object-[50%_30%] transition-transform duration-500 group-hover:scale-[1.03]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 text-white md:p-5">
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-[#1b1405]">{a.category}</span>
          <h2 className={`mt-2 font-serif font-semibold leading-tight ${size === 'lg' ? 'text-2xl md:text-4xl' : 'line-clamp-3 text-lg'}`}>{a.title}</h2>
          <p className="mt-1.5 text-xs text-white/80">{a.source_name}, {timeAgo(a.published_at)}</p>
        </div>
      </Link>
    </article>
  );
}

function CompactCard({ a }: { a: Article }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-line/70 bg-surface transition hover:border-brand/40 hover:shadow-sm">
      <Link href={`/berita/${a.slug}`} className="relative block aspect-[4/3] overflow-hidden bg-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.image_url && (
          <img
            src={imgSrc(a.image_url, UKURAN_TAMPIL.kartu)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover object-[50%_35%] transition-transform duration-500 group-hover:scale-[1.04]"
          />
        )}
        {/* Hanya keterangan pendek yang menumpuk di gambar, bukan judul. */}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-2 gap-y-1 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-[#1b1405]">{a.category}</span>
          <span className="truncate text-[11px] font-medium text-white/90">{a.source_name}</span>
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-3 font-serif text-sm font-semibold leading-snug text-ink sm:text-base">
          <Link href={`/berita/${a.slug}`} className="hover:text-brand">{a.title}</Link>
        </h3>
        <p className="mt-auto pt-2 text-[11px] text-muted">{timeAgo(a.published_at)}</p>
      </div>
    </article>
  );
}
