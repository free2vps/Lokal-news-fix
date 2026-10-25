import Link from 'next/link';
import { SITE } from '@/config/site';
import { CATEGORIES, slugify } from '@/lib/utils';
import { getTrending } from '@/lib/queries';
import SearchForm from './SearchForm';
import ThemeToggle from './ThemeToggle';
import TrendTicker from './TrendTicker';

export default async function Header() {
  const trending = await getTrending();
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' });
  const tab = 'block whitespace-nowrap rounded-md px-3 py-2 text-muted hover:bg-line/60 hover:text-ink';
  return (
    <>
      <header>
        <div className="bg-brand text-bg">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-1.5 text-xs">
            <span className="font-medium">{today}</span><span className="hidden sm:inline">Berita lokal, hiburan, dan video pilihan</span>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5 font-serif text-3xl font-bold tracking-tight text-brand">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand text-2xl text-bg" aria-hidden>{SITE.name[0]}</span>
            <span className="hidden sm:inline">{SITE.name}</span>
          </Link>
          <div className="mx-auto w-full max-w-2xl"><SearchForm /></div>
          <ThemeToggle />
        </div>
      </header>
      <div className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
        <nav aria-label="Menu utama" className="border-t border-line">
          <ul className="scrollbar-none mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 text-sm font-medium">
            <li><Link href="/" className="block rounded-md px-3 py-2 text-brand">Beranda</Link></li>
            <li><Link href="/hiburan" className="block rounded-md px-3 py-2 font-semibold text-pop hover:bg-pop/10">Hiburan</Link></li>
            <li><Link href="/#video" className={tab}>Video</Link></li>
            {CATEGORIES.map((c) => <li key={c}><Link href={`/kategori/${slugify(c)}`} className={tab}>{c}</Link></li>)}
          </ul>
        </nav>
        <TrendTicker items={trending} />
      </div>
    </>
  );
}
