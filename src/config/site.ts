const RAW_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * F-12: bila `NEXT_PUBLIC_SITE_URL` lupa diisi di Vercel, seluruh canonical, OG URL, dan sitemap
 * akan menunjuk ke localhost — kegagalan senyap yang merusak SEO tanpa satu pun pesan galat.
 * Sekarang build DIBATALKAN di lingkungan Vercel/produksi bila itu terjadi.
 */
if (process.env.VERCEL === '1' && process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/.test(RAW_URL)) {
  throw new Error('NEXT_PUBLIC_SITE_URL wajib diisi di produksi (sekarang menunjuk ke localhost).');
}

export const SITE = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || 'Kabar Lokal',
  url: RAW_URL,
  description: 'Rangkuman berita lokal terkini dari berbagai sumber terpercaya, lengkap dengan tautan ke artikel aslinya.',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'redaksi@example.com',
};
