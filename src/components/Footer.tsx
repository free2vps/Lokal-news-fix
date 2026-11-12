import type { ReactElement } from 'react';
import Link from 'next/link';
import { SITE } from '@/config/site';
import { getSocialLinks } from '@/lib/queries';
import Logo from './Logo';

const legal = [['/pemda', 'Pemda NTB'], ['/disclaimer', 'Disclaimer & Hak Cipta'], ['/pedoman-media', 'Pedoman Media & Hak Jawab'], ['/privacy-policy', 'Kebijakan Privasi']];

/** Ikon digambar langsung (SVG sebaris) supaya tidak bergantung berkas/CDN luar. */
const ICONS: Record<string, ReactElement> = {
  facebook: <path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.25-1.5 1.55-1.5H16.7V4.6c-.29-.04-1.3-.13-2.47-.13-2.44 0-4.11 1.49-4.11 4.23v2.2H7.4V14h2.72v8z" />,
  instagram: <><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm0 5.6a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4Z" /><path d="M16.2 3H7.8A4.8 4.8 0 0 0 3 7.8v8.4A4.8 4.8 0 0 0 7.8 21h8.4a4.8 4.8 0 0 0 4.8-4.8V7.8A4.8 4.8 0 0 0 16.2 3Zm3.6 13.2a3.6 3.6 0 0 1-3.6 3.6H7.8a3.6 3.6 0 0 1-3.6-3.6V7.8a3.6 3.6 0 0 1 3.6-3.6h8.4a3.6 3.6 0 0 1 3.6 3.6Z" /><circle cx="16.8" cy="7.2" r="1" /></>,
  x: <path d="M17.2 3h3.1l-6.8 7.8L21 21h-5.7l-4.5-5.9L5.6 21H2.5l7.2-8.2L2 3h5.8l4.2 5.6zm-1 16h1.7L7.9 4.7H6.1z" />,
  tiktok: <path d="M16.6 2h-3v13.1a2.6 2.6 0 1 1-2.6-2.6c.27 0 .53.04.78.12V9.5a5.8 5.8 0 0 0-.78-.05 5.6 5.6 0 1 0 5.6 5.6V8.7a6.6 6.6 0 0 0 3.8 1.2V6.8a3.8 3.8 0 0 1-3.8-3.8z" />,
  youtube: <><path d="M21.6 7.9a2.5 2.5 0 0 0-1.75-1.77C18.2 5.7 12 5.7 12 5.7s-6.2 0-7.85.43A2.5 2.5 0 0 0 2.4 7.9 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.1 2.5 2.5 0 0 0 1.75 1.77C5.8 18.3 12 18.3 12 18.3s6.2 0 7.85-.43a2.5 2.5 0 0 0 1.75-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.1ZM10.1 15V9l5.2 3z" /></>,
  whatsapp: <path d="M12 2a9.9 9.9 0 0 0-8.5 15L2 22l5.2-1.4A9.9 9.9 0 1 0 12 2Zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20Zm4.6-5.9c-.25-.13-1.5-.74-1.73-.82-.23-.09-.4-.13-.57.13-.17.25-.65.82-.8 1-.14.17-.29.19-.54.06a6.5 6.5 0 0 1-1.9-1.18 7.2 7.2 0 0 1-1.32-1.65c-.14-.25-.02-.38.11-.5.13-.13.29-.34.43-.5.13-.17.18-.29.27-.48.09-.2.04-.36-.02-.5-.06-.13-.55-1.35-.76-1.85-.2-.48-.4-.42-.55-.43h-.47c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.6.13.17 1.77 2.83 4.3 3.86.6.26 1.07.41 1.44.53.6.19 1.15.16 1.58.1.48-.07 1.5-.61 1.7-1.2.22-.6.22-1.1.16-1.2-.06-.11-.23-.17-.48-.3Z" />,
};

export default async function Footer() {
  // Diisi dari panel Hub (menu Pengaturan Situs), bukan env — ikut pindah saat ganti hosting.
  const social = await getSocialLinks();
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 text-sm md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo size={32} name={SITE.name} />
          <p className="mt-2 max-w-md text-muted">Kami merangkum berita dari media dan situs resmi, lalu mengarahkan Anda ke artikel aslinya. Hak cipta isi berita dimiliki masing-masing sumber.</p>
          <p className="mt-2 text-muted">Pengaduan konten: <a className="text-brand underline" href={`mailto:${SITE.email}`}>{SITE.email}</a></p>
        </div>

        {/* Media sosial: hanya tampil bila akunnya sudah diisi di pengaturan (env). */}
        {social.length > 0 && (
          <nav aria-labelledby="sosmed-h">
            <h2 id="sosmed-h" className="mb-3 font-semibold text-ink">Ikuti kami</h2>
            <ul className="flex flex-wrap gap-2">
              {social.map((s) => (
                <li key={s.key}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer me" aria-label={s.label} title={s.label}
                    className="grid h-10 w-10 place-items-center rounded-full border border-line bg-bg text-muted transition hover:border-brand hover:bg-brand hover:text-bg">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>{ICONS[s.key]}</svg>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav aria-label="Halaman legal"><ul className="space-y-2">
          {legal.map(([h, t]) => <li key={h}><Link href={h} className="text-ink hover:text-brand hover:underline">{t}</Link></li>)}
        </ul></nav>
      </div>
      <p className="border-t border-line py-4 text-center text-xs text-muted">© {new Date().getFullYear()}{' '}{SITE.name}</p>
    </footer>
  );
}
