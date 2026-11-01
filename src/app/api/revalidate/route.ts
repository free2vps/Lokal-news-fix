import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createHash, timingSafeEqual } from 'node:crypto';
import { TAG_ARTICLES, TAG_REGIONS, TAG_TRENDS } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hub memanggil alamat ini SETELAH berhasil menulis artikel baru ke Supabase.
 *
 * Kenapa perlu: halaman publik kini di-cache (ISR). Tanpa pemberitahuan, berita baru bisa
 * tertahan sampai masa cache habis. Dengan ini, berita baru tampil pada permintaan berikutnya.
 *
 * Keamanan: wajib header `x-revalidate-secret` yang nilainya sama dengan HUB_REVALIDATE_SECRET.
 * Perbandingan memakai timingSafeEqual dan menolak bila rahasianya belum diatur.
 */
function matches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected || expected.length < 16) return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const noStore = { 'Cache-Control': 'no-store' } as const;
  if (!matches(request.headers.get('x-revalidate-secret'), process.env.HUB_REVALIDATE_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Rahasia tidak sesuai.' }, { status: 401, headers: noStore });
  }
  const tags: string[] = [TAG_ARTICLES, TAG_REGIONS, TAG_TRENDS];
  for (const tag of tags) revalidateTag(tag);
  return NextResponse.json({ ok: true, revalidated: tags, at: new Date().toISOString() }, { headers: noStore });
}
