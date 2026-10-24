import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import type { Source } from '@/lib/types';
import { addSource, deleteSource, syncNow, syncTrending, addHype, deleteTrend } from './actions';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const input = 'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm';

export default async function Admin({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { data } = await supabaseAdmin().from('sources').select('*').order('id');
  const sources = (data ?? []) as Source[];
  const { data: manual } = await supabaseAdmin().from('trending').select('id,platform,title,expires_at').eq('source', 'manual').order('id', { ascending: false }).limit(20);
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="font-serif text-3xl font-semibold">Admin</h1>
      {msg && <p role="status" className="rounded-md border border-brand bg-brand/10 p-3 text-sm">{msg}</p>}

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-serif text-xl font-semibold">Sinkronisasi</h2>
        <p className="mt-1 text-sm text-muted">Memeriksa semua sumber aktif dan memproses berita baru sekarang juga.</p>
        <form action={syncNow} className="mt-3"><button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-bg">Sync sekarang</button></form>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-serif text-xl font-semibold">Trending & hype sosial</h2>
        <p className="mt-1 text-sm text-muted">Topik dari Google Trends, X, dan YouTube diambil otomatis tiap jam. Untuk TikTok, Instagram, Facebook, dan Threads, tambahkan postingan yang sedang ramai secara manual.</p>
        <form action={syncTrending} className="mt-3"><button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-bg">Sync trending sekarang</button></form>
        <form action={addHype} className="mt-4 grid gap-3 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <select name="platform" className={input}>{['tiktok', 'instagram', 'facebook', 'threads', 'x', 'youtube'].map((p) => <option key={p}>{p}</option>)}</select>
            <input name="hours" type="number" min={1} max={168} defaultValue={24} className={input} aria-label="Tampil selama (jam)" placeholder="Tampil selama (jam)" />
          </div>
          <input name="title" required placeholder="Judul/deskripsi singkat postingan" className={input} />
          <input name="url" required type="url" placeholder="https://… tautan postingan" className={input} />
          <input name="image" type="url" placeholder="URL gambar (opsional, hanya jika Anda berhak memakainya)" className={input} />
          <button className="justify-self-start rounded-md bg-accent px-4 py-2 text-sm font-semibold text-[#1b1405]">Tambah hype</button>
        </form>
        <ul className="mt-4 divide-y divide-line text-sm">
          {(manual ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate"><b>{m.platform}</b> {m.title}</span>
              <form action={deleteTrend}><input type="hidden" name="id" value={m.id} /><button className="rounded-md border border-line px-3 py-1 text-muted hover:text-ink">Hapus</button></form>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-serif text-xl font-semibold">Tambah sumber</h2>
        <form action={addSource} className="mt-3 grid gap-3">
          <input name="name" required placeholder="Nama media (tampil sebagai atribusi)" className={input} />
          <select name="type" className={input}><option value="rss">RSS feed</option><option value="scrape">Scraper halaman daftar berita</option></select>
          <select name="section" className={input}><option value="berita">Bagian: Berita</option><option value="hiburan">Bagian: Hiburan / infotainment</option></select>
          <input name="url" required type="url" placeholder="https://… (URL feed atau halaman daftar berita)" className={input} />
          <textarea name="selectors" rows={2} placeholder={'Opsional (scraper): {"link":"h3 a","article":".entry-content"}'} className={input} />
          <button className="justify-self-start rounded-md bg-accent px-4 py-2 text-sm font-semibold text-[#1b1405]">Simpan sumber</button>
        </form>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-serif text-xl font-semibold">Sumber terdaftar ({sources.length})</h2>
        <ul className="mt-3 divide-y divide-line">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0"><p className="font-medium">{s.name} <span className="text-muted">({s.type}, {s.section})</span></p>
                <p className="truncate text-muted">{s.url}</p>
                <p className="text-xs text-muted">Terakhir dicek: {s.last_fetched_at ? new Date(s.last_fetched_at).toLocaleString('id-ID') : 'belum pernah'}</p></div>
              <form action={deleteSource}><input type="hidden" name="id" value={s.id} /><button className="rounded-md border border-line px-3 py-1.5 text-muted hover:text-ink">Hapus</button></form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
