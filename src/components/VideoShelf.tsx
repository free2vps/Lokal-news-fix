'use client';
import { useState } from 'react';
import type { Trend } from '@/lib/types';

const idOf = (u: string | null) => u?.match(/[?&]v=([\w-]{11})/)?.[1] ?? '';

export default function VideoShelf({ picks, trending }: { picks: Trend[]; trending: Trend[] }) {
  const tabs = [
    ...(picks.length ? [{ key: 'pilihan', label: 'Pilihan', items: picks }] : []),
    ...(trending.length ? [{ key: 'trending', label: 'Trending Indonesia', items: trending }] : []),
  ];
  const [tab, setTab] = useState(0);
  const [idx, setIdx] = useState(0);
  const [play, setPlay] = useState(false);
  if (!tabs.length) return null;
  const cur = tabs[Math.min(tab, tabs.length - 1)];
  const items = cur.items.slice(0, 8);
  const v = items[Math.min(idx, items.length - 1)];
  const id = idOf(v.url);

  return (
    <section id="video" aria-labelledby="video-h" className="scroll-mt-32">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b-2 border-pop pb-1">
        <h2 id="video-h" className="font-serif text-2xl font-semibold text-pop">Video</h2>
        {tabs.length > 1 && (
          <div role="tablist" className="flex gap-1 text-sm">
            {tabs.map((t, i) => (
              <button key={t.key} role="tab" aria-selected={i === tab} onClick={() => { setTab(i); setIdx(0); setPlay(false); }}
                className={`rounded-full px-3 py-1 font-medium ${i === tab ? 'bg-pop text-white' : 'text-muted hover:bg-line/60'}`}>{t.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            {play ? (
              <iframe src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title={v.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="absolute inset-0 h-full w-full" />
            ) : (
              <button onClick={() => setPlay(true)} aria-label={`Putar video: ${v.title}`} className="group absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.image_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100" />
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-pop text-white shadow-lg transition group-hover:scale-105">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </span>
              </button>
            )}
          </div>
          <h3 className="mt-3 font-serif text-xl font-semibold leading-snug">{v.title}</h3>
          {v.metric && <p className="text-sm text-muted">{v.metric}</p>}
        </div>
        <ul className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
          {items.map((it, i) => (
            <li key={it.id}>
              <button onClick={() => { setIdx(i); setPlay(false); }} aria-current={i === idx}
                className={`flex w-full gap-3 rounded-lg p-2 text-left ${i === idx ? 'bg-pop/10 ring-1 ring-pop/40' : 'hover:bg-line/50'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.image_url || ''} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-28 shrink-0 rounded-md bg-line/50 object-cover" />
                <span className="min-w-0"><span className="line-clamp-2 text-sm font-medium leading-snug">{it.title}</span><span className="mt-0.5 block truncate text-xs text-muted">{it.metric}</span></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {cur.key === 'trending' && <p className="mt-2 text-xs text-muted">Daftar dari youtube.trends24.in, diperbarui tiap jam. Video diputar langsung dari YouTube.</p>}
    </section>
  );
}
