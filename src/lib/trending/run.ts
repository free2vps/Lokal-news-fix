import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '../supabase';
import type { TrendRow } from '../types';
import { fetchGoogle, fetchX, fetchYouTube, fetchTrends24X, fetchTrends24YT, fetchYtFeeds } from './adapters';

export async function runTrending() {
  const db = supabaseAdmin();
  const result: Record<string, string> = {};
  const jobs: [string, () => Promise<TrendRow[]>][] = [['google', fetchGoogle], ['x', fetchX], ['youtube', fetchYouTube], ['x_t24', fetchTrends24X], ['yt_t24', fetchTrends24YT], ['yt_feed', fetchYtFeeds]];
  for (const [name, fn] of jobs) {
    try {
      const rows = await fn();
      if (!rows.length) { result[name] = 'dilewati (tidak ada data/key)'; continue; }
      // data lama baru dihapus setelah pengambilan berhasil; entri manual tidak tersentuh
      await db.from('trending').delete().eq('source', 'auto').eq('platform', name);
      const { error } = await db.from('trending').insert(rows.map((r) => ({ ...r, source: 'auto' })));
      result[name] = error ? `gagal: ${error.message}` : `${rows.length} item`;
    } catch (e) { result[name] = `gagal: ${(e as Error).message}`; }
  }
  revalidatePath('/');
  return result;
}
