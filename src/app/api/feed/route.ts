import { NextResponse } from 'next/server';
import { getMixedPage, sortByNewest, withinHours } from '@/lib/queries';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const num = (k: string) => Math.max(0, Number(p.get(k)) || 0);
  const hours = Math.min(168, Math.max(1, Number(p.get('h')) || 36));
  const data = await getMixedPage(Math.min(num('page'), 200), { news: num('n'), fun: num('f') }, { sinceHours: hours });
  return NextResponse.json(sortByNewest(withinHours(data, hours)), { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } });
}
