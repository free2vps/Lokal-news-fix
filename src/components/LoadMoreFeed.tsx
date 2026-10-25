'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article } from '@/lib/types';
import FeedRow from './FeedRow';

export default function LoadMoreFeed({ skipNews, skipFun, initialDone = false }: { skipNews: number; skipFun: number; initialDone?: boolean }) {
  const [items, setItems] = useState<Article[]>([]);
  const [page, setPage] = useState(1);
  const [done, setDone] = useState(initialDone);
  const [busy, setBusy] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      const data: Article[] = await (await fetch(`/api/feed?page=${page}&n=${skipNews}&f=${skipFun}`)).json();
      setItems((x) => [...x, ...data]);
      setPage((p) => p + 1);
      if (data.length < 10) setDone(true);
    } catch { /* tombol tetap bisa dicoba lagi */ } finally { setBusy(false); }
  }, [busy, done, page, skipNews, skipFun]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && load(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [load, done]);

  return (
    <>
      {items.map((a) => <FeedRow key={a.id} a={a} />)}
      <div ref={sentinel} className="py-8 text-center text-sm text-muted">
        {done ? 'Anda sudah sampai di berita paling lama.' : (
          <button onClick={load} disabled={busy} className="rounded-full border border-line bg-surface px-6 py-2.5 font-medium hover:border-brand disabled:opacity-60">{busy ? 'Memuat…' : 'Muat berita lainnya'}</button>
        )}
      </div>
    </>
  );
}
