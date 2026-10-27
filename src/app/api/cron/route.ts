import { NextResponse } from 'next/server';
import { runSync } from '@/lib/ingest/pipeline';
import { distributeBatch } from '@/lib/distribution';
import { importContentHub } from '@/lib/content-hub/import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (process.env.CONTENT_HUB_ENABLED === 'true') {
    try { const stats=await importContentHub(); return NextResponse.json(stats,{status:stats.errors.length?207:200}); }
    catch { return NextResponse.json({ ok: false, error: 'Impor Content Hub gagal; data lama dipertahankan' }, { status: 502 }); }
  }
  const stats = await runSync();
  const distribution = await distributeBatch(Number(process.env.DISTRIBUTE_PER_RUN ?? 2)); // 0 = matikan antrean
  return NextResponse.json({ ...stats, distribution });
}
