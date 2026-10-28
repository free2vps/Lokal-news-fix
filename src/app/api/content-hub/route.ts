import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request) {
  return NextResponse.json({ ok: false, error: 'API Hub publik lama dinonaktifkan sampai hanya menampilkan data yang disetujui.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
