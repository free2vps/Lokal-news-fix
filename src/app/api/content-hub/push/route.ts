import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function POST() {
  return NextResponse.json({ ok: false, error: 'Push lama dinonaktifkan sampai persetujuan revisi dan anti-replay terintegrasi.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
