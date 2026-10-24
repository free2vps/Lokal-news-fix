import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Newsreader, Instrument_Sans } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import { SITE } from '@/config/site';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import AdSlot from '@/components/AdSlot';
import StickyAd from '@/components/StickyAd';

const serif = Newsreader({ subsets: ['latin'], variable: '--font-serif', display: 'swap' });
const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} - Berita Lokal Terkini`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  openGraph: { type: 'website', locale: 'id_ID', siteName: SITE.name, url: SITE.url },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};
export const viewport: Viewport = { themeColor: '#0E5E63' };

const themeInit = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const adsense = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  return (
    <html lang="id" suppressHydrationWarning className={`${serif.variable} ${sans.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body className="flex min-h-screen flex-col">
        <Header />
        <div className="mx-auto w-full max-w-6xl px-4 pt-4"><AdSlot slot="header" /></div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 md:pb-10">{children}</main>
        <Footer />
        <StickyAd />
        <Analytics />
        {adsense && <Script async src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsense}`} crossOrigin="anonymous" strategy="afterInteractive" />}
      </body>
    </html>
  );
}
