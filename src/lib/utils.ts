export const CATEGORIES = ['Pemerintahan', 'Politik', 'Ekonomi', 'Hukum & Kriminal', 'Pendidikan', 'Kesehatan', 'Olahraga', 'Lingkungan', 'Teknologi', 'Sosial & Budaya', 'Umum'];

export function slugify(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export const categoryFromSlug = (slug: string) => CATEGORIES.find((c) => slugify(c) === slug);

export function formatDate(d: string, withTime = true) {
  return new Date(d).toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }) + (withTime ? ' WITA' : '');
}
export function timeAgo(d: string) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 604800) return rtf.format(-Math.round(s / 86400), 'day');
  return formatDate(d, false);
}
