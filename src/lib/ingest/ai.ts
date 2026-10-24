import { categoriesFor } from '../utils';
import { REGIONS } from '../../config/regions';
import { callJSON } from '../ai/llm';
import type { RawItem } from './scraper';

export type AIResult = {
  title: string; summary: string; headings: string[]; keyPoints: string[]; metaTitle: string; metaDescription: string;
  slugHint: string; category: string; tags: string[]; socialCaption: string;
};

const AREAS = REGIONS.map((r) => r.name).join(', ');

// AGEN 1 (peringkas): menulis ulang isi berita. Dijalankan oleh kumpulan penyedia yang dirotasi.
const summarizerSystem = (section: string) => `Kamu editor ${section === 'hiburan' ? 'hiburan dan gaya hidup' : 'berita lokal'} Indonesia untuk situs kurasi yang dioptimalkan untuk Google Discover.
Tulis ulang dengan KALIMAT SENDIRI (jangan menyalin kalimat sumber). Aturan wajib: gunakan hanya fakta dari teks sumber; jangan menambah fakta, angka, nama, atau kutipan; bahasa Indonesia baku yang enak dibaca di ponsel.
${section === 'hiburan' ? 'Nada boleh lebih hidup, tetapi jangan menyebarkan rumor atau tuduhan tentang orang sungguhan; gunakan "dilaporkan" atau "menurut sumber" bila sumber memakainya.' : 'Nada netral.'}
Wilayah prioritas: ${AREAS}. Bila berita menyangkut salah satunya, tulis namanya persis seperti ejaan itu di judul.
Balas HANYA JSON dengan kunci:
"title": judul 55-80 karakter, jujur dan informatif; sebut pelaku/lokasi utama dan inti peristiwa; boleh menyisakan SATU detail yang membuat orang ingin tahu asalkan artikel menjawabnya. Dilarang huruf kapital semua, tanda seru, klaim yang tidak ada di sumber, dan frasa seperti "tidak akan percaya", "bikin geger", "wow".
"summary": 2-3 paragraf dipisah "\\n\\n" (total 110-180 kata). Paragraf 1 (maksimal 2 kalimat) langsung menjawab apa, siapa, kapan, di mana, mengapa, dan bagaimana; berikutnya konteks atau dampak.
"headings": array subjudul H2 untuk paragraf ke-2 dan ke-3 (jumlah = paragraf dikurangi 1), maksimal 60 karakter, deskriptif.
"key_points": array 3-4 poin, masing-masing maksimal 22 kata.
"social_caption": 1-2 kalimat (maksimal 220 karakter) pembuka postingan media sosial; faktual, memancing rasa ingin tahu secara jujur; tanpa URL dan hashtag.`;

// AGEN 2 (SEO): hanya mengekstrak metadata dari hasil ringkasan, bukan dari artikel mentah.
const seoSystem = (section: string) => `Kamu spesialis SEO untuk situs berita ${section === 'hiburan' ? 'hiburan' : 'lokal'} berbahasa Indonesia. Dari judul dan ringkasan yang diberikan, ekstrak metadata. Jangan menambah fakta baru.
Balas HANYA JSON dengan kunci:
"meta_title": maksimal 60 karakter, memuat topik utama (dan nama wilayah bila relevan), tidak clickbait.
"meta_description": 120-155 karakter.
"slug_hint": 4-7 kata kunci huruf kecil dipisah spasi tanpa kata sambung.
"category": salah satu dari: ${categoriesFor(section).join(', ')}.
"tags": array 3-5 kata kunci huruf kecil (boleh nama wilayah, instansi, tokoh, atau topik).
Wilayah prioritas (tulis persis): ${AREAS}.`;

const BAIT = /(tidak akan percaya|bikin geger|bikin kaget|\bwow\b|\bsyok\b|!)/i;

/** Pakai judul AI hanya bila aman: bukan umpan klik, panjang wajar, dan kata-katanya berakar pada sumber. */
export function chooseTitle(aiTitle: string, original: string, text: string) {
  const t = (aiTitle || '').trim().replace(/\s+/g, ' ');
  if (t.length < 25 || t.length > 100 || BAIT.test(t) || t === t.toUpperCase()) return original;
  const words = t.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  const src = `${original} ${text}`.toLowerCase();
  const hit = words.filter((w) => src.includes(w)).length;
  return words.length && hit / words.length >= 0.6 ? t : original;
}

const arr = (x: unknown, n: number) => (Array.isArray(x) ? x : []).map((v) => String(v).trim()).filter(Boolean).slice(0, n);

export async function summarize(item: RawItem, source = '-', section = 'berita'): Promise<AIResult> {
  let s;
  try {
    s = (await callJSON('summary', summarizerSystem(section), `Sumber: ${source}\nJudul sumber: ${item.title}\n\nTeks sumber:\n${item.text.slice(0, 3500)}`)).data;
  } catch (e) { throw new Error(`AI gagal: ${(e as Error).message}`); }
  const summary = String(s.summary || '').trim();
  if (summary.length < 80) throw new Error('AI gagal: ringkasan terlalu pendek');
  const title = chooseTitle(String(s.title || ''), item.title, item.text);

  let seo: any = {};
  try { // kegagalan agen SEO tidak membatalkan artikel; dipakai metadata cadangan
    seo = (await callJSON('seo', seoSystem(section), `Judul: ${title}\n\nRingkasan:\n${summary}`)).data;
  } catch { /* fallback di bawah */ }

  const cats = categoriesFor(section);
  return {
    title,
    summary,
    headings: arr(s.headings, 2).map((h) => h.slice(0, 80)),
    keyPoints: arr(s.key_points, 4),
    metaTitle: String(seo.meta_title || title).slice(0, 70),
    metaDescription: String(seo.meta_description || summary).replace(/\s+/g, ' ').slice(0, 160),
    slugHint: String(seo.slug_hint || '').slice(0, 80),
    category: cats.includes(seo.category) ? seo.category : section === 'hiburan' ? 'Viral & Trending' : 'Umum',
    tags: arr(seo.tags, 5).map((t) => t.toLowerCase()),
    socialCaption: String(s.social_caption || '').replace(/\s+/g, ' ').slice(0, 240),
  };
}
