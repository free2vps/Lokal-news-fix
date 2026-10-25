import { NextResponse } from 'next/server';
import { getMixedPage } from '@/lib/queries';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const num = (k: string) => Math.max(0, Number(p.get(k)) || 0);
  const data = await getMixedPage(Math.min(num('page'), 200), { news: num('n'), fun: num('f') });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } });
}
