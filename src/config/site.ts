export const SITE = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || 'Kabar Lokal',
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  description: 'Rangkuman berita lokal terkini dari berbagai sumber terpercaya, lengkap dengan tautan ke artikel aslinya.',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'redaksi@example.com',
};
