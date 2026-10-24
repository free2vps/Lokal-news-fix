import Link from 'next/link';
import { SITE } from '@/config/site';
import { CATEGORIES, slugify } from '@/lib/utils';
import { getTrending } from '@/lib/queries';
import SearchForm from './SearchForm';
import ThemeToggle from './ThemeToggle';
import { topicsOf } from './TrendingNow';

export default async function Header() {
  const topics = topicsOf(await getTrending()).slice(0, 6);
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' });
  return (
    <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur">
      <div className="bg-brand text-bg">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-1.5 text-xs">
          <span className="shrink-0 font-medium">{today}</span>
          {topics.length > 0 && (
            <nav aria-label="Topik trending" className="scrollbar-none flex min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap">
              <span className="shrink-0 rounded bg-accent px-1.5 py-px font-semibold text-[#1b1405]">Trending</span>
              {topics.map((t) => <Link key={t.id} href={`/cari?q=${encodeURIComponent(t.title)}`} className="hover:underline">{t.title}</Link>)}
            </nav>
          )}
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-serif text-3xl font-bold tracking-tight text-brand">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-brand text-xl text-bg" aria-hidden>{SITE.name[0]}</span>
          <span className="hidden sm:inline">{SITE.name}</span>
        </Link>
        <div className="ml-auto flex w-full max-w-xs items-center gap-2 sm:max-w-md"><SearchForm /><ThemeToggle /></div>
      </div>
      <nav aria-label="Kategori" className="border-b border-line">
        <ul className="scrollbar-none mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 py-1 text-sm font-medium">
          <li><Link href="/" className="block rounded-md px-3 py-1.5 text-brand">Beranda</Link></li>
          {CATEGORIES.map((c) => <li key={c}><Link href={`/kategori/${slugify(c)}`} className="block whitespace-nowrap rounded-md px-3 py-1.5 text-muted hover:bg-line/60 hover:text-ink">{c}</Link></li>)}
        </ul>
      </nav>
    </header>
  );
}
