/**
 * Pengaturan situs yang diisi dari panel Hub (bukan env server).
 *
 * Alasan: nilai seperti tautan media sosial harus bisa diubah dari panel, dan harus ikut
 * pindah saat hosting diganti. Env Vercel hilang begitu pindah hosting; baris di database tidak.
 *
 * Tabel dibuat sendiri saat pertama dipakai (CREATE TABLE IF NOT EXISTS) supaya tidak perlu
 * menjalankan SQL manual — pemilik portal tidak bisa/tidak mau menjalankan SQL di Turso.
 */
import type { Client } from '@libsql/client';

export const SOCIAL_KEYS = [
  'social_facebook',
  'social_instagram',
  'social_x',
  'social_tiktok',
  'social_youtube',
  'social_whatsapp',
] as const;
export type SocialKey = typeof SOCIAL_KEYS[number];

export type SiteSocial = { key: string; label: string; url: string };

const LABELS: Record<SocialKey, string> = {
  social_facebook: 'Facebook',
  social_instagram: 'Instagram',
  social_x: 'X',
  social_tiktok: 'TikTok',
  social_youtube: 'YouTube',
  social_whatsapp: 'WhatsApp Channel',
};

// Ditandai PER KONEKSI, bukan satu variabel global: bila penandanya global, database kedua
// (atau database yang baru dibuat ulang) tidak pernah dibuatkan tabelnya.
const ensured = new WeakSet<Client>();

/** Idempoten, aman dijalankan berkali-kali, tidak mengubah data yang sudah ada. */
export async function ensureSiteSettingsTable(db: Client): Promise<void> {
  if (ensured.has(db)) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS hub_site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  ensured.add(db);
}

/**
 * Tautan hanya diterima bila benar-benar tautan web yang aman.
 * Yang ditolak: bukan https/http, memuat nama pengguna/sandi, atau terlalu panjang.
 */
export function validSocialUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return '';
  if (value.length > 300) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Baca semua pengaturan sosial untuk panel admin. */
export async function readSiteSettings(db: Client): Promise<Record<SocialKey, string>> {
  const empty = Object.fromEntries(SOCIAL_KEYS.map((k) => [k, ''])) as Record<SocialKey, string>;
  try {
    await ensureSiteSettingsTable(db);
    const rows = (await db.execute('SELECT key, value FROM hub_site_settings')).rows;
    for (const row of rows) {
      const key = String(row.key) as SocialKey;
      if ((SOCIAL_KEYS as readonly string[]).includes(key)) empty[key] = String(row.value ?? '');
    }
  } catch {
    // Tabel belum ada / database belum siap: kembalikan kosong, jangan gagalkan halaman.
  }
  return empty;
}

/** Simpan hanya kunci yang dikirim; kunci lain tidak disentuh. */
export async function saveSiteSettings(db: Client, input: Record<string, unknown>): Promise<{ saved: string[] }> {
  await ensureSiteSettingsTable(db);
  const saved: string[] = [];
  const now = new Date().toISOString();
  for (const key of SOCIAL_KEYS) {
    if (!(key in input)) continue;
    const url = validSocialUrl(input[key]);
    if (url === null) throw new Error('SOCIAL_URL_INVALID:' + key);
    await db.execute({
      sql: `INSERT INTO hub_site_settings(key,value,updated_at) VALUES(?,?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      args: [key, url, now],
    });
    saved.push(key);
  }
  return { saved };
}

/**
 * Bentuk siap-pakai untuk footer publik. Hanya tautan yang terisi yang dikembalikan,
 * supaya tidak ada tombol yang menuju halaman kosong.
 */
export async function readPublicSocial(db: Client): Promise<SiteSocial[]> {
  const values = await readSiteSettings(db);
  return SOCIAL_KEYS
    .filter((k) => values[k])
    .map((k) => ({ key: k.replace('social_', ''), label: LABELS[k], url: values[k] }));
}
