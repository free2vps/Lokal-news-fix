export const NEWS_CATEGORIES = ['Info Pemda', 'Peristiwa Daerah', 'Lowongan & CPNS', 'Event & Kebijakan Lokal', 'Politik', 'Ekonomi', 'Hukum & Kriminal', 'Pendidikan', 'Kesehatan', 'Olahraga', 'Lingkungan', 'Teknologi', 'Sosial & Budaya', 'Umum'];

export const FUN_CATEGORIES = ['Selebriti', 'Film & Musik', 'Gaya Hidup', 'Viral & Trending', 'Kuliner & Wisata'];
export const CATEGORIES = NEWS_CATEGORIES; // menu berita
export const ALL_CATEGORIES = [...NEWS_CATEGORIES, ...FUN_CATEGORIES];
export const categoriesFor = (section: string) => (section === 'hiburan' ? FUN_CATEGORIES : NEWS_CATEGORIES);

// Niche lokal berkompetisi rendah: aturan kata kunci menimpa pilihan AI bila berita bersifat lokal.
const LOCAL_RULES: [string, RegExp][] = [
  ['Lowongan & CPNS', /\b(lowongan|rekrutmen|pendaftaran (?:cpns|pppk|asn)|seleksi (?:calon )?(?:cpns|pppk|asn|pegawai)|formasi (?:cpns|pppk|asn)|loker)\b/i],
  ['Event & Kebijakan Lokal', /\b(festival|pekan raya|bazar|musrenbang|sosialisasi|perda|perbup|pergub|peraturan (bupati|daerah|gubernur|wali ?kota)|kebijakan)\b/i],
  ['Info Pemda', /\b(pemda|pemkab|pemkot|pemprov|bupati|wakil bupati|wali ?kota|gubernur|dprd|apbd|bappeda|sekda|dinas)\b/i],
  ['Peristiwa Daerah', /\b(kecelakaan|kebakaran|banjir|longsor|gempa|ditemukan tewas|hilang|basarnas|bpbd|polres|polsek)\b/i],
];
export function refineCategory(text: string, aiCategory: string, region: string | null) {
  const jobs=LOCAL_RULES[0][1].test(text);
  if(!jobs&&/\b(bank|bpr|perbankan|pembiayaan|pinjaman|kredit|umkm|keuangan)\b/i.test(text))return 'Ekonomi';
  const hit = LOCAL_RULES.find(([, re]) => re.test(text));
  if (hit && (region || hit[0] === 'Lowongan & CPNS')) return hit[0];
  return aiCategory;
}

export function slugify(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export const categoryFromSlug = (slug: string) => ALL_CATEGORIES.find((c) => slugify(c) === slug);

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
