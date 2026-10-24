'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { runSync } from '@/lib/ingest/pipeline';
import { runTrending } from '@/lib/trending/run';

const back = (msg: string) => redirect('/admin?msg=' + encodeURIComponent(msg));

export async function addSource(fd: FormData) {
  const url = String(fd.get('url') || '').trim();
  const name = String(fd.get('name') || '').trim();
  const type = fd.get('type') === 'scrape' ? 'scrape' : 'rss';
  let selectors = {};
  try { const raw = String(fd.get('selectors') || '').trim(); if (raw) selectors = JSON.parse(raw); } catch { return back('Selectors bukan JSON yang valid'); }
  try { new URL(url); } catch { return back('URL tidak valid'); }
  if (!name) return back('Nama sumber wajib diisi');
  const { error } = await supabaseAdmin().from('sources').insert({ name, type, url, selectors });
  revalidatePath('/admin');
  back(error ? `Gagal: ${error.message}` : 'Sumber ditambahkan');
}

export async function deleteSource(fd: FormData) {
  await supabaseAdmin().from('sources').delete().eq('id', Number(fd.get('id')));
  revalidatePath('/admin');
  back('Sumber dihapus');
}

export async function syncNow() {
  const s = await runSync();
  const groups = new Map<string, number>();
  for (const e of s.errors) {
    const m = e.replace(/^https?:\/\/\S+?:\s/, '').slice(0, 300);
    groups.set(m, (groups.get(m) || 0) + 1);
  }
  const top = [...groups].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m, n]) => `${n}x ${m}`).join(' | ');
  back(`Selesai: ${s.inserted} berita baru dari ${s.found} kandidat, ${s.errors.length} error.${top ? ' Penyebab: ' + top : ''}`);
}

export async function syncTrending() {
  const r = await runTrending();
  back('Trending: ' + Object.entries(r).map(([k, v]) => `${k} ${v}`).join('; '));
}

const SOCIAL = ['tiktok', 'instagram', 'facebook', 'threads', 'x', 'youtube'];
export async function addHype(fd: FormData) {
  const platform = String(fd.get('platform'));
  const title = String(fd.get('title') || '').trim().slice(0, 160);
  const url = String(fd.get('url') || '').trim();
  const image = String(fd.get('image') || '').trim() || null;
  const hours = Math.min(168, Math.max(1, Number(fd.get('hours')) || 24));
  try { new URL(url); } catch { return back('URL tidak valid'); }
  if (!SOCIAL.includes(platform) || !title) return back('Platform dan judul wajib diisi');
  const { error } = await supabaseAdmin().from('trending').insert({
    platform, kind: 'post', source: 'manual', rank: 0, title, url, image_url: image,
    expires_at: new Date(Date.now() + hours * 3600_000).toISOString(),
  });
  revalidatePath('/');
  back(error ? `Gagal: ${error.message}` : 'Postingan hype ditambahkan');
}

export async function deleteTrend(fd: FormData) {
  await supabaseAdmin().from('trending').delete().eq('id', Number(fd.get('id')));
  revalidatePath('/');
  back('Entri dihapus');
}
