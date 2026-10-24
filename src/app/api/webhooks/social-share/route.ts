import { NextResponse } from 'next/server';
import { dispatchArticle } from '@/lib/distribution';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Menerima Supabase Database Webhook (INSERT pada tabel articles) atau panggilan manual {"id": 123}.
export async function POST(req: Request) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.record?.id ?? body?.id);
  if (!id) return NextResponse.json({ error: 'id wajib' }, { status: 400 });
  try { return NextResponse.json(await dispatchArticle(id)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
