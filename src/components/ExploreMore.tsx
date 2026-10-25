import Link from 'next/link';
import { regionName } from '@/config/regions';
import { CATEGORIES, slugify } from '@/lib/utils';

export default function ExploreMore({ regions }: { regions: string[] }) {
  const link = 'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-line/40 hover:text-brand';
  return (
    <nav aria-label="Jelajahi" className="rounded-2xl border border-line/70 bg-surface p-3">
      <h2 className="px-2 pb-1 text-lg font-bold">Jelajahi</h2>
      <ul>
        <li><Link href="/hiburan" className={`${link} text-pop`}>Hiburan &amp; viral</Link></li>
        {CATEGORIES.slice(0, 8).map((c) => <li key={c}><Link href={`/kategori/${slugify(c)}`} className={link}>{c}</Link></li>)}
      </ul>
      {regions.length > 0 && (
        <>
          <h3 className="mt-3 border-t border-line/60 px-2 pb-1 pt-3 text-sm font-bold text-muted">Wilayah</h3>
          <ul>{regions.slice(0, 6).map((r) => <li key={r}><Link href={`/wilayah/${r}`} className={link}>{regionName(r) ?? r}</Link></li>)}</ul>
        </>
      )}
    </nav>
  );
}
