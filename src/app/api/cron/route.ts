import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
// Fail closed: the legacy cron bypassed review and could scrape or distribute.
export async function GET() {
  return NextResponse.json({ ok: false, error: 'Cron lama dinonaktifkan dalam proyek terpadu; antrean baru belum aktif.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
