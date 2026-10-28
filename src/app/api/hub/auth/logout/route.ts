import { NextResponse } from 'next/server';
import { getHubDb } from '@/server/hub/db/client';
import { logoutOwner } from '@/server/hub/security/auth';
import { NO_STORE, errorJson, invalidMutation, sessionCookie, setSession } from '@/server/hub/security/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const rejected = invalidMutation(request); if (rejected) return rejected;
  try {
    await logoutOwner(getHubDb(), sessionCookie(request));
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    setSession(response, request, '', 0);
    return response;
  } catch { return errorJson('Gagal mengakhiri sesi.', 503); }
}
