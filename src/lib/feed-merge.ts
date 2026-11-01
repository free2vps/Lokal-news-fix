import type { Article } from './types';

/**
 * Gabungkan hasil pilihan Hub dengan artikel terbit terbaru dari database situs.
 *
 * Aturan (tanpa data karangan):
 * - Artikel pilihan Hub dipakai lebih dulu, urutannya dipertahankan.
 * - Sisa slot diisi artikel terbit terbaru dari database (urut tanggal terbit terbaru),
 *   sehingga beranda tidak pernah kosong hanya karena snapshot Hub kosong/kedaluwarsa.
 * - Duplikat dibuang berdasarkan id, atau slug, atau source_url.
 * - Bila `hub` kosong seluruhnya, hasilnya sama dengan daftar terbaru biasa.
 */
export function mergeFeed(hub: Article[], latest: Article[], limit: number, offset = 0): Article[] {
  const seen = new Set<string>();
  const keys = (a: Article) => [a.id, a.slug, a.source_url].filter(Boolean).map(String).map(k => 'k:' + k);
  const picked: Article[] = [];
  const push = (a: Article) => {
    const ks = keys(a);
    if (!ks.length) return;
    if (ks.some(k => seen.has(k))) return; // duplikat bila salah satu identitas sudah tampil
    for (const k of ks) seen.add(k);
    picked.push(a);
  };
  for (const a of hub) push(a);
  for (const a of latest) push(a);
  const start = Math.max(0, offset);
  return picked.slice(start, start + Math.max(0, limit));
}

/** true bila hasil Hub belum memenuhi jumlah yang diminta (perlu isi dari artikel terbit). */
export function needsLatestFill(hub: Article[], limit: number) {
  return hub.length < Math.max(0, limit);
}

/**
 * Gabungkan tren snapshot Hub (X/YouTube) dengan baris tabel `trending` yang masih berlaku.
 * Snapshot Hub didahulukan; duplikat dibuang berdasarkan platform + judul.
 * Bila snapshot Hub kosong, hasilnya sama dengan perilaku lama (tidak ada yang hilang).
 */
export function mergeTrends<T extends {platform?: string | null; title?: string | null}>(hub: T[], rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const push = (t: T) => {
    const key = `${String(t.platform || '')}|${String(t.title || '').trim().toLowerCase()}`;
    if (!String(t.title || '').trim() || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const t of hub) push(t);
  for (const t of rows) push(t);
  return out;
}
