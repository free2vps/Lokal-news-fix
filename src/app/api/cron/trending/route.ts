import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ ok: false, error: 'Sinkronisasi trending lama dinonaktifkan; adapter baru belum aktif.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
