import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function POST() {
  return NextResponse.json({ ok: false, error: 'Distribusi sosial lama dinonaktifkan; perlu alur persetujuan dan otorisasi baru.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
