import { NextResponse } from 'next/server';
import { runSync } from '@/lib/ingest/pipeline';
import { distributeBatch } from '@/lib/distribution';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const stats = await runSync();
  const distribution = await distributeBatch(Number(process.env.DISTRIBUTE_PER_RUN ?? 2)); // 0 = matikan antrean
  return NextResponse.json({ ...stats, distribution });
}
