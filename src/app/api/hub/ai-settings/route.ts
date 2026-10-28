import { NextResponse } from 'next/server';
import { readAiSettings, saveAiSetting } from '@/server/hub/domain/ai-settings';
import { authenticatedDb, errorJson, invalidMutation, NO_STORE, readJson } from '@/server/hub/security/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access = await authenticatedDb(request); if (access.error) return access.error;
  try { return NextResponse.json({ ok: true, ...await readAiSettings(access.db, process.env.HUB_MASTER_KEY) }, { headers: NO_STORE }); }
  catch { return errorJson('Pengaturan AI belum dapat dibaca.', 503); }
}
export async function POST(request: Request) {
  const rejected = invalidMutation(request); if (rejected) return rejected;
  const access = await authenticatedDb(request); if (access.error) return access.error;
  let body: Record<string, unknown>;
  try { body = await readJson(request); } catch { return errorJson('Permintaan tidak valid atau terlalu besar.', 400); }
  try {
    await saveAiSetting(access.db, { provider: body.provider, model: body.model, apiKey: body.apiKey }, process.env.HUB_MASTER_KEY);
    return NextResponse.json({ ok: true, runtime: 'not_implemented' }, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'AI_MODEL_INVALID') return errorJson('Provider/model tidak valid. Model OpenRouter harus berakhiran :free.', 400);
    if (code === 'AI_KEY_INVALID') return errorJson('Format API key tidak valid.', 400);
    if (code === 'MASTER_KEY_REQUIRED') return errorJson('Kunci enkripsi backend belum disiapkan; API key tidak disimpan.', 503);
    return errorJson('Pengaturan AI gagal disimpan.', 503);
  }
}
