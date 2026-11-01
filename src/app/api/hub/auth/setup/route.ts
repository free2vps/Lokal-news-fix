import { NextResponse } from 'next/server';
import { getHubDb } from '@/server/hub/db/client';
import { setupOwner } from '@/server/hub/security/auth';
import { NO_STORE, errorJson, invalidMutation, readJson, setSession } from '@/server/hub/security/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const rejected = invalidMutation(request); if (rejected) return rejected;
  let body: Record<string, unknown>;
  try { body = await readJson(request); } catch { return errorJson('Permintaan tidak valid atau terlalu besar.', 400); }
  try {
    const result = await setupOwner(getHubDb(), { password: body.password, token: body.token }, process.env.HUB_SETUP_TOKEN);
    if (!result.ok) {
      const messages: Record<string, [string, number]> = { RATE_LIMIT: ['Terlalu banyak percobaan; coba lagi nanti.', 429], SETUP_DISABLED: ['Pengaturan awal belum diizinkan.', 503], ALREADY_CONFIGURED: ['Akun sudah diatur; silakan masuk.', 409], PASSWORD_INVALID: ['Password harus 12–200 karakter.', 400], UNAUTHORIZED: ['Token pengaturan tidak valid.', 401] };
      const [message, status] = messages[result.code] || ['Pengaturan gagal.', 400]; return errorJson(message, status);
    }
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    setSession(response, request, result.session);
    return response;
  } catch { return errorJson('Pengaturan gagal; periksa database dan koneksi HTTPS.', 503); }
}
