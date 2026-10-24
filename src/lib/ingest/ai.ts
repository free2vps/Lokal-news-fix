import { CATEGORIES } from '../utils';
import type { RawItem } from './scraper';

export type AIResult = { summary: string; keyPoints: string[]; metaTitle: string; metaDescription: string; category: string; tags: string[] };

const SYSTEM = `Kamu editor berita lokal Indonesia. Tugasmu membuat sintesis berita dengan KALIMAT SENDIRI (jangan menyalin kalimat sumber).
Aturan: gunakan hanya fakta yang ada di teks sumber, jangan menambah fakta, angka, atau kutipan baru; bahasa Indonesia baku yang komunikatif; netral.
Balas HANYA JSON dengan kunci:
"summary": string 2-3 paragraf dipisah "\\n\\n" (total 90-170 kata),
"key_points": array 3-4 string (masing-masing maksimal 22 kata),
"meta_title": string maksimal 60 karakter, menarik dan tidak clickbait,
"meta_description": string 120-155 karakter,
"category": salah satu dari: ${CATEGORIES.join(', ')},
"tags": array 3-5 kata kunci huruf kecil.`;

const userPrompt = (i: RawItem) => `Judul sumber: ${i.title}\n\nTeks sumber:\n${i.text.slice(0, 3500)}`;

async function groq(user: string) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(40000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', temperature: 0.3, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 140)}`);
  return (await r.json()).choices[0].message.content as string;
}

async function gemini(user: string) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST', signal: AbortSignal.timeout(40000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 140)}`);
  return (await r.json()).candidates[0].content.parts[0].text as string;
}

export async function summarize(item: RawItem): Promise<AIResult> {
  const user = userPrompt(item);
  const order = process.env.AI_PROVIDER === 'gemini' ? ['gemini', 'groq'] : ['groq', 'gemini'];
  let lastErr: unknown;
  for (const p of order) {
    if (p === 'groq' ? !process.env.GROQ_API_KEY : !process.env.GEMINI_API_KEY) continue;
    try {
      const raw = (p === 'groq' ? await groq(user) : await gemini(user)).replace(/^```json|```$/g, '').trim();
      const j = JSON.parse(raw);
      const summary = String(j.summary || '').trim();
      if (summary.length < 80) throw new Error('Ringkasan terlalu pendek');
      return {
        summary,
        keyPoints: (Array.isArray(j.key_points) ? j.key_points : []).map(String).slice(0, 4),
        metaTitle: String(j.meta_title || item.title).slice(0, 70),
        metaDescription: String(j.meta_description || summary).replace(/\s+/g, ' ').slice(0, 160),
        category: CATEGORIES.includes(j.category) ? j.category : 'Umum',
        tags: (Array.isArray(j.tags) ? j.tags : []).map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 5),
      };
    } catch (e) { lastErr = e; }
  }
  throw new Error(`AI gagal: ${(lastErr as Error)?.message ?? 'tidak ada API key'}`);
}
