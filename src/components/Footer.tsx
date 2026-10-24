import Link from 'next/link';
import { SITE } from '@/config/site';

const legal = [['/disclaimer', 'Disclaimer & Hak Cipta'], ['/pedoman-media', 'Pedoman Media & Hak Jawab'], ['/privacy-policy', 'Kebijakan Privasi']];

export default function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm md:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="font-serif text-xl font-semibold text-brand">{SITE.name}</p>
          <p className="mt-2 max-w-md text-muted">Kami merangkum berita dari media dan situs resmi, lalu mengarahkan Anda ke artikel aslinya. Hak cipta isi berita dimiliki masing-masing sumber.</p>
          <p className="mt-2 text-muted">Pengaduan konten: <a className="text-brand underline" href={`mailto:${SITE.email}`}>{SITE.email}</a></p>
        </div>
        <nav aria-label="Halaman legal"><ul className="space-y-2">
          {legal.map(([h, t]) => <li key={h}><Link href={h} className="text-ink hover:text-brand hover:underline">{t}</Link></li>)}
        </ul></nav>
      </div>
      <p className="border-t border-line py-4 text-center text-xs text-muted">© {new Date().getFullYear()} {SITE.name}</p>
    </footer>
  );
}
