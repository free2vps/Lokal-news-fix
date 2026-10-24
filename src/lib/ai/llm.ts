// Lapisan multi-penyedia LLM: rotasi beban, cadangan otomatis, dan jeda (cooldown) untuk penyedia yang bermasalah.
type Msg = { system: string; user: string };
type Prov = { enabled: () => boolean; call: (m: Msg) => Promise<string> };

const env = (k: string) => process.env[k] || '';
const short = (t: string) => t.replace(/\s+/g, ' ').slice(0, 140);

function compat(name: string, url: string, keyEnv: string, modelEnv: string, def: string): Prov {
  return {
    enabled: () => !!env(keyEnv) && !!(env(modelEnv) || def),
    call: async (m) => {
      const go = (json: boolean) => fetch(url, {
        method: 'POST', signal: AbortSignal.timeout(40000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env(keyEnv)}` },
        body: JSON.stringify({
          model: env(modelEnv) || def, temperature: 0.3, ...(json ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: m.system }, { role: 'user', content: m.user }],
        }),
      });
      let r = await go(true);
      if (r.status === 400) { const t = await r.text(); if (/response_format|json/i.test(t)) r = await go(false); else throw new Error(`${name} 400: ${short(t)}`); }
      if (!r.ok) throw new Error(`${name} ${r.status}: ${short(await r.text())}`);
      return (await r.json()).choices[0].message.content as string;
    },
  };
}

const PROVIDERS: Record<string, Prov> = {
  groq: compat('groq', 'https://api.groq.com/openai/v1/chat/completions', 'GROQ_API_KEY', 'GROQ_MODEL', 'openai/gpt-oss-120b'),
  cerebras: compat('cerebras', 'https://api.cerebras.ai/v1/chat/completions', 'CEREBRAS_API_KEY', 'CEREBRAS_MODEL', 'gpt-oss-120b'),
  deepseek: compat('deepseek', 'https://api.deepseek.com/chat/completions', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'deepseek-chat'),
  mistral: compat('mistral', 'https://api.mistral.ai/v1/chat/completions', 'MISTRAL_API_KEY', 'MISTRAL_MODEL', 'mistral-small-latest'),
  openrouter: compat('openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', ''), // mis. model DeepSeek gratis
  gemini: {
    enabled: () => !!env('GEMINI_API_KEY'),
    call: async (m) => {
      const model = env('GEMINI_MODEL') || 'gemini-2.5-flash';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env('GEMINI_API_KEY')}`, {
        method: 'POST', signal: AbortSignal.timeout(40000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: m.system }] }, contents: [{ role: 'user', parts: [{ text: m.user }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }),
      });
      if (!r.ok) throw new Error(`gemini ${r.status}: ${short(await r.text())}`);
      return (await r.json()).candidates[0].content.parts[0].text as string;
    },
  },
  cohere: { // kunci trial: 1.000 panggilan/bulan dan tidak boleh untuk penggunaan komersial. Pakai kunci produksi.
    enabled: () => !!env('COHERE_API_KEY'),
    call: async (m) => {
      const r = await fetch('https://api.cohere.com/v2/chat', {
        method: 'POST', signal: AbortSignal.timeout(40000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('COHERE_API_KEY')}` },
        body: JSON.stringify({ model: env('COHERE_MODEL') || 'command-a-03-2025', temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: m.system }, { role: 'user', content: m.user }] }),
      });
      if (!r.ok) throw new Error(`cohere ${r.status}: ${short(await r.text())}`);
      return (await r.json()).message.content[0].text as string;
    },
  },
};

const DEFAULTS = { summary: 'groq,cerebras,gemini,deepseek', seo: 'mistral,groq,gemini' };
const cooldown = new Map<string, number>();
let rr = 0;

function parseJSON(t: string) {
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 ? t.slice(a, b + 1) : t);
}

/** role "summary": beban dirotasi antarpenyedia. role "seo": urutan tetap (penyedia pertama diprioritaskan). */
export async function callJSON(role: 'summary' | 'seo', system: string, user: string) {
  const names = (env(role === 'seo' ? 'SEO_PROVIDERS' : 'SUMMARY_PROVIDERS') || DEFAULTS[role]).split(',').map((s) => s.trim()).filter(Boolean);
  let list = names.filter((n) => PROVIDERS[n]?.enabled());
  if (!list.length) throw new Error(`tidak ada penyedia AI aktif untuk peran ${role}`);
  if (role === 'summary') { const k = rr++ % list.length; list = [...list.slice(k), ...list.slice(0, k)]; }
  const errs: string[] = [];
  for (const n of list) {
    if ((cooldown.get(n) ?? 0) > Date.now()) { errs.push(`${n}: jeda`); continue; }
    try {
      return { data: parseJSON(await PROVIDERS[n].call({ system, user })), provider: n };
    } catch (e) {
      const msg = (e as Error).message;
      const code = Number(msg.match(/ (\d{3}):/)?.[1]);
      if (code === 429) cooldown.set(n, Date.now() + 90_000);                       // batas per-menit/harian: istirahat sebentar
      else if ([401, 402, 403, 404].includes(code)) cooldown.set(n, Date.now() + 30 * 60_000); // key/model bermasalah
      errs.push(msg);
    }
  }
  throw new Error(errs.join(' // '));
}
