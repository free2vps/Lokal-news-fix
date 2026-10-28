'use client';
import { useState } from 'react';
import type { Article } from '@/lib/types';
import { appendUniqueArticles, feedIsExhausted, validFeedResponse } from '@/lib/feed-pagination';
import FeedRow from './FeedRow';

export default function LoadMoreFeed({ skipNews, skipFun, initialDone = false, initialIds = [] }: {
  skipNews: number; skipFun: number; initialDone?: boolean; initialIds?: number[];
}) {
  const [items, setItems] = useState<Article[]>([]);
  const [page, setPage] = useState(1);
  const [done, setDone] = useState(initialDone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    if (busy || done) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/feed?page=${page}&n=${skipNews}&f=${skipFun}`);
      if (!response.ok) throw Error('Feed gagal');
      const data: unknown = await response.json();
      if (!validFeedResponse(data)) throw Error('Feed tidak valid');
      setItems(current => appendUniqueArticles(current, data, initialIds));
      setPage(current => current + 1);
      if (feedIsExhausted(data)) setDone(true);
    } catch {
      setError('Berita tambahan belum dapat dimuat. Berita yang sudah tampil tetap tersedia.');
    } finally { setBusy(false); }
  }
  return <>
    {items.map(a => <FeedRow key={a.id} a={a} />)}
    <div className="py-8 text-center text-sm text-muted" aria-busy={busy}>
      {error && <p role="alert" className="mb-3">{error}</p>}
      {done ? <p>Belum ada berita tambahan pada pembaruan ini.</p> :
        <button onClick={load} disabled={busy} className="rounded-full border border-line bg-surface px-6 py-2.5 font-medium hover:border-brand disabled:opacity-60">
          {busy ? 'Memuat…' : error ? 'Coba muat lagi' : 'Muat berita lainnya'}
        </button>}
    </div>
  </>;
}
