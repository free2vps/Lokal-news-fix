import { NextResponse } from 'next/server';
import { getLatest } from '@/lib/queries';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const offset = Math.max(0, Number(p.get('offset')) || 0);
  const limit = Math.min(24, Number(p.get('limit')) || 12);
  const data = await getLatest({ limit, offset, category: p.get('category') || undefined, section: p.get('section') || undefined });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } });
}
