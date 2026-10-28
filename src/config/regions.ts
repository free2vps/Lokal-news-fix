// Sesuaikan dengan wilayah target Anda. Alias yang lebih panjang diprioritaskan (mis. "Sumbawa Barat" sebelum "Sumbawa").
export type Region = { slug: string; name: string; aliases: string[] };

export const REGIONS: Region[] = [
  { slug: 'bali', name: 'Bali', aliases: ['Bali'] },
  { slug: 'denpasar', name: 'Denpasar', aliases: ['Denpasar'] },
  { slug: 'badung', name: 'Badung', aliases: ['Badung'] },
  { slug: 'gianyar', name: 'Gianyar', aliases: ['Gianyar'] },
  { slug: 'tabanan', name: 'Tabanan', aliases: ['Tabanan'] },
  { slug: 'jembrana', name: 'Jembrana', aliases: ['Jembrana'] },
  { slug: 'karangasem', name: 'Karangasem', aliases: ['Karangasem'] },
  { slug: 'buleleng', name: 'Buleleng', aliases: ['Buleleng'] },
  { slug: 'klungkung', name: 'Klungkung', aliases: ['Klungkung'] },
  { slug: 'bangli', name: 'Bangli', aliases: ['Bangli'] },
  { slug: 'ntt', name: 'Nusa Tenggara Timur', aliases: ['Nusa Tenggara Timur', 'NTT'] },
  { slug: 'kupang', name: 'Kupang', aliases: ['Kupang'] },
  { slug: 'manggarai', name: 'Manggarai', aliases: ['Manggarai', 'Labuan Bajo'] },
  { slug: 'ende', name: 'Ende', aliases: ['Ende'] },
  { slug: 'sikka', name: 'Sikka', aliases: ['Sikka', 'Maumere'] },
  { slug: 'sumba', name: 'Sumba', aliases: ['Sumba'] },
  { slug: 'flores', name: 'Flores', aliases: ['Flores'] },
  { slug: 'sumbawa-barat', name: 'Sumbawa Barat', aliases: ['Sumbawa Barat', 'KSB', 'Taliwang', 'Maluk', 'Jereweh', 'Poto Tano'] },
  { slug: 'sumbawa', name: 'Sumbawa', aliases: ['Sumbawa Besar', 'Kabupaten Sumbawa', 'Sumbawa'] },
  { slug: 'mataram', name: 'Kota Mataram', aliases: ['Kota Mataram', 'Mataram'] },
  { slug: 'lombok-barat', name: 'Lombok Barat', aliases: ['Lombok Barat', 'Gerung'] },
  { slug: 'lombok-tengah', name: 'Lombok Tengah', aliases: ['Lombok Tengah', 'Praya', 'Mandalika'] },
  { slug: 'lombok-timur', name: 'Lombok Timur', aliases: ['Lombok Timur', 'Selong'] },
  { slug: 'lombok-utara', name: 'Lombok Utara', aliases: ['Lombok Utara', 'Tanjung'] },
  { slug: 'bima', name: 'Bima', aliases: ['Kota Bima', 'Kabupaten Bima', 'Bima'] },
  { slug: 'dompu', name: 'Dompu', aliases: ['Dompu'] },
  { slug: 'ntb', name: 'Nusa Tenggara Barat', aliases: ['Nusa Tenggara Barat', 'NTB'] },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAIRS = REGIONS.flatMap((r) => r.aliases.map((a) => [a, r.slug] as const)).sort((a, b) => b[0].length - a[0].length);
const B = '(?<![\\p{L}\\d])';
const A = '(?![\\p{L}\\d])';

export const regionName = (slug?: string | null) => REGIONS.find((r) => r.slug === slug)?.name;

/** Wilayah yang paling banyak disebut dalam teks (aturan pasti, tidak bergantung AI). */
export function detectRegion(text: string): string | null {
  let t = ` ${text} `;
  const score = new Map<string, number>();
  for (const [alias, slug] of PAIRS) {
    const re = new RegExp(`${B}${esc(alias)}${A}`, 'giu');
    const m = t.match(re);
    if (m) { score.set(slug, (score.get(slug) || 0) + m.length); t = t.replace(re, ' '); }
  }
  let best: string | null = null, n = 0;
  for (const [k, v] of score) if (v > n) { best = k; n = v; }
  return best;
}

/** Pecah teks menjadi potongan biasa dan tautan wilayah (hanya kemunculan pertama tiap wilayah). */
export function splitByRegion(text: string, used: Set<string>): Array<string | { slug: string; text: string }> {
  const re = new RegExp(`${B}(${PAIRS.map((p) => esc(p[0])).join('|')})${A}`, 'giu');
  const out: Array<string | { slug: string; text: string }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const slug = PAIRS.find((p) => p[0].toLowerCase() === m[0].toLowerCase())![1];
    if (used.has(slug)) continue;
    used.add(slug);
    out.push(text.slice(last, m.index), { slug, text: m[0] });
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
