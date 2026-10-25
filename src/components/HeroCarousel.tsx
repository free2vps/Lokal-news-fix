'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Article } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

export default function HeroCarousel({ slides }: { slides: Article[] }) {
  const n = slides.length;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hold, setHold] = useState(false);

  useEffect(() => { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false); }, []);
  useEffect(() => {
    if (!playing || hold || n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), 5500);
    return () => clearInterval(t);
  }, [playing, hold, n]);
  useEffect(() => { const nx = slides[(i + 1) % n]?.image_url; if (nx) new Image().src = nx; }, [i, n, slides]); // siapkan gambar berikutnya
  if (!n) return null;

  const a = slides[i];
  const go = (d: number) => setI((i + d + n) % n);
  const btn = 'grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/75';

  return (
    <section aria-roledescription="carousel" aria-label="Berita pilihan" className="relative overflow-hidden rounded-2xl bg-brand"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocusCapture={() => setHold(true)} onBlurCapture={() => setHold(false)}>
      <div key={a.id} className="fade-in" aria-live={playing ? 'off' : 'polite'}>
        <Link href={`/berita/${a.slug}`} className="relative block aspect-[4/3] sm:aspect-[16/10]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {a.image_url && <img src={a.image_url} alt="" fetchPriority={i === 0 ? 'high' : 'auto'} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4 pr-28 text-white sm:p-6 sm:pr-32">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${a.section === 'hiburan' ? 'bg-pop text-white' : 'bg-accent text-[#1b1405]'}`}>{a.category}</span>
            <h2 className="mt-2 line-clamp-3 font-serif text-xl font-semibold leading-tight sm:text-3xl">{a.title}</h2>
            <p className="mt-1.5 text-xs text-white/80">{a.source_name}, {timeAgo(a.published_at)}</p>
          </div>
        </Link>
      </div>
      {n > 1 && (
        <>
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <span className="rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur">{i + 1} dari {n}</span>
            <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Jeda pergantian otomatis' : 'Putar pergantian otomatis'} className="grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/75">
              {playing ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg> : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>}
            </button>
          </div>
          <div className="absolute bottom-4 right-3 flex gap-2 sm:bottom-6">
            <button onClick={() => go(-1)} aria-label="Berita sebelumnya" className={btn}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg></button>
            <button onClick={() => go(1)} aria-label="Berita berikutnya" className={btn}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg></button>
          </div>
        </>
      )}
    </section>
  );
}
