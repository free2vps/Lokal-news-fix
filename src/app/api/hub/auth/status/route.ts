import { NextResponse } from 'next/server';
import { getHubDb } from '@/server/hub/db/client';
import { hasSession, isConfigured } from '@/server/hub/security/auth';
import { NO_STORE, sessionCookie, errorJson } from '@/server/hub/security/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const db = getHubDb();
    const configured = await isConfigured(db);
    return NextResponse.json({ ok: true, configured, authenticated: configured && await hasSession(db, sessionCookie(request)), setupAvailable: !configured && (process.env.HUB_SETUP_TOKEN?.length || 0) >= 32 }, { headers: NO_STORE });
  } catch { return errorJson('Database Hub belum siap atau tidak dapat diakses.', 503); }
}
