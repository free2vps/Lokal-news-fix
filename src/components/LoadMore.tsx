'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article } from '@/lib/types';
import NewsCard from './NewsCard';

export default function LoadMore({ start, category, initialDone = false, pageSize = 12 }: { start: number; category?: string; initialDone?: boolean; pageSize?: number }) {
  const [items, setItems] = useState<Article[]>([]);
  const [offset, setOffset] = useState(start);
  const [done, setDone] = useState(initialDone);
  const [busy, setBusy] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      const p = new URLSearchParams({ offset: String(offset), limit: String(pageSize) });
      if (category) p.set('category', category);
      const data: Article[] = await (await fetch('/api/articles?' + p)).json();
      setItems((x) => [...x, ...data]);
      setOffset((o) => o + data.length);
      if (data.length < pageSize) setDone(true);
    } catch { /* tombol tetap bisa dicoba lagi */ } finally { setBusy(false); }
  }, [busy, done, offset, category, pageSize]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && load(), { rootMargin: '500px' });
    io.observe(el);
    return () => io.disconnect();
  }, [load, done]);

  return (
    <>
      {items.length > 0 && <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((a) => <NewsCard key={a.id} a={a} />)}</div>}
      <div ref={sentinel} className="py-8 text-center text-sm text-muted">
        {done ? 'Anda sudah sampai di berita paling lama.' : (
          <button onClick={load} disabled={busy} className="rounded-md border border-line bg-surface px-5 py-2 font-medium text-ink hover:border-brand disabled:opacity-60">
            {busy ? 'Memuat…' : 'Muat berita lainnya'}
          </button>
        )}
      </div>
    </>
  );
}
