import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { readSiteSettings, saveSiteSettings, SOCIAL_KEYS } from '@/server/hub/domain/site-settings';
import { authenticatedDb, errorJson, invalidMutation, NO_STORE, readJson } from '@/server/hub/security/http';
import { TAG_SITE } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await authenticatedDb(request);
  if (access.error) return access.error;
  try {
    return NextResponse.json({ ok: true, social: await readSiteSettings(access.db) }, { headers: NO_STORE });
  } catch {
    return errorJson('Pengaturan situs belum dapat dibaca.', 503);
  }
}

export async function POST(request: Request) {
  const rejected = invalidMutation(request);
  if (rejected) return rejected;
  const access = await authenticatedDb(request);
  if (access.error) return access.error;
  let body: Record<string, unknown>;
  try { body = await readJson(request); } catch { return errorJson('Permintaan tidak valid atau terlalu besar.', 400); }
  const payload = Object.fromEntries(SOCIAL_KEYS.map((k) => [k, body[k]]));
  try {
    const result = await saveSiteSettings(access.db, payload);
    // Halaman publik memakai cache ber-tag; beri tahu agar footer langsung berubah.
    try { revalidateTag(TAG_SITE); } catch { /* cache tidak tersedia (mis. pratinjau lokal) */ }
    return NextResponse.json({ ok: true, saved: result.saved }, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code.startsWith('SOCIAL_URL_INVALID')) {
      return errorJson('Tautan media sosial harus berupa alamat lengkap yang dimulai https:// dan tanpa nama pengguna/sandi.', 400);
    }
    return errorJson('Pengaturan situs gagal disimpan.', 503);
  }
}
