import { NextResponse } from 'next/server';
import { getHubDb } from '@/server/hub/db/client';
import { loginOwner } from '@/server/hub/security/auth';
import { NO_STORE, errorJson, invalidMutation, readJson, setSession } from '@/server/hub/security/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const rejected = invalidMutation(request); if (rejected) return rejected;
  let body: Record<string, unknown>;
  try { body = await readJson(request); } catch { return errorJson('Permintaan tidak valid atau terlalu besar.', 400); }
  try {
    const result = await loginOwner(getHubDb(), body.password);
    if (!result.ok) return errorJson(result.code === 'RATE_LIMIT' ? 'Terlalu banyak percobaan; coba lagi nanti.' : 'Password tidak valid.', result.code === 'RATE_LIMIT' ? 429 : 401);
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    setSession(response, request, result.session);
    return response;
  } catch { return errorJson('Login gagal; periksa database dan koneksi HTTPS.', 503); }
}
