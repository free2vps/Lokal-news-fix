import type {Client} from '@libsql/client';
import {decryptSecret, encryptSecret, masterKeyConfigured} from '../security/encryption';

/**
 * Sumber video YouTube yang SAH.
 *
 * Kenyataannya (diperiksa langsung 2 Nov 2026):
 *   https://www.youtube.com/robots.txt
 *   User-agent: *
 *   Disallow: /feeds/videos.xml
 *
 * Jadi feed RSS playlist DILARANG robots.txt. Sesuai aturan pemilik proyek, kita TIDAK
 * mencari akal-akalan untuk menembusnya. Jalur yang sah adalah **YouTube Data API v3**:
 * API resmi, berkuota (10.000 unit/hari, satu tarikan playlist = 1 unit), tidak diperiksa
 * robots.txt karena memang diperuntukkan bagi program.
 *
 * Kunci API disimpan terenkripsi dengan master key, sama seperti kunci penyedia AI.
 * Kunci TIDAK pernah dikirim balik ke layar; layar hanya menerima keterangan "sudah diisi".
 */

export const YT_API = 'https://www.googleapis.com/youtube/v3/playlistItems';
export const YT_API_POLICY = {maxResults: 25, timeoutMs: 12000, unitsPerCall: 1} as const;

export async function prepareYoutubeSchema(db: Client) {
  await db.execute(`CREATE TABLE IF NOT EXISTS hub_youtube_key_v1(
    id TEXT PRIMARY KEY CHECK(id='owner'),
    key_ciphertext TEXT, key_hint TEXT, updated_at TEXT)`);
  await db.execute("INSERT OR IGNORE INTO hub_youtube_key_v1(id,updated_at) VALUES('owner',?)",
    [new Date(0).toISOString()]);
}

/** Simpan kunci API. Kunci hanya menyentuh server; nilai aslinya tidak pernah dikembalikan. */
export async function saveYoutubeKey(db: Client, apiKey: unknown, master: string | undefined) {
  if (!masterKeyConfigured(master)) throw Error('MASTER_KEY_REQUIRED');
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key.length < 20 || key.length > 200 || !/^[A-Za-z0-9_-]+$/.test(key)) throw Error('YOUTUBE_KEY_INVALID');
  const cipher = encryptSecret(key, 'youtube', master);
  const hint = key.slice(0, 4) + '…' + key.slice(-4);
  await db.execute({sql: "UPDATE hub_youtube_key_v1 SET key_ciphertext=?,key_hint=?,updated_at=? WHERE id='owner'",
    args: [cipher, hint, new Date().toISOString()]});
  return {keyConfigured: true, keyHint: hint};
}

export async function clearYoutubeKey(db: Client) {
  await db.execute("UPDATE hub_youtube_key_v1 SET key_ciphertext=NULL,key_hint=NULL,updated_at=? WHERE id='owner'",
    [new Date().toISOString()]);
  return {keyConfigured: false};
}

export async function youtubeKeyStatus(db: Client, master: string | undefined) {
  const r = (await db.execute("SELECT key_ciphertext,key_hint,updated_at FROM hub_youtube_key_v1 WHERE id='owner'")).rows[0];
  const ada = Boolean(r?.key_ciphertext);
  let terbaca = false;
  if (ada) { try { decryptSecret(String(r?.key_ciphertext), 'youtube', master); terbaca = true; } catch { terbaca = false; } }
  return {
    keyConfigured: ada, keyReadable: terbaca,
    keyHint: ada ? String(r?.key_hint || '') : null,
    updatedAt: ada ? String(r?.updated_at || '') : null,
    masterKeyReady: masterKeyConfigured(master),
    feedBlockedByRobots: true,
    note: ada ? 'Video ditarik lewat YouTube Data API (sah dan berkuota).'
      : 'Feed RSS playlist dilarang robots.txt YouTube. Isi kunci YouTube Data API agar video bisa ditarik.',
  };
}

async function apiKey(db: Client, master: string | undefined) {
  const r = (await db.execute("SELECT key_ciphertext FROM hub_youtube_key_v1 WHERE id='owner'")).rows[0];
  if (!r?.key_ciphertext) return null;
  try { return decryptSecret(String(r.key_ciphertext), 'youtube', master); } catch { return null; }
}

export type VideoItem = {videoId: string; title: string; channel: string; videoUrl: string; publishedAt: string | null};

/** Ubah jawaban YouTube Data API menjadi daftar video. Tidak mengarang: yang tidak sah dibuang. */
export function mapApiResponse(payload: unknown): VideoItem[] {
  const items = (payload as {items?: unknown})?.items;
  if (!Array.isArray(items)) return [];
  const out: VideoItem[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const it = raw as {snippet?: {title?: unknown; channelTitle?: unknown; publishedAt?: unknown; resourceId?: {videoId?: unknown}}};
    const id = String(it?.snippet?.resourceId?.videoId || '');
    const title = String(it?.snippet?.title || '').trim();
    if (!/^[\w-]{11}$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({
      videoId: id, title: title.slice(0, 300),
      channel: String(it?.snippet?.channelTitle || '').slice(0, 120),
      videoUrl: 'https://www.youtube.com/watch?v=' + id,
      publishedAt: it?.snippet?.publishedAt ? String(it.snippet.publishedAt) : null,
    });
  }
  return out;
}

/** Tarik playlist lewat API resmi. Hanya dipakai bila kunci tersedia. */
export async function fetchPlaylistViaApi(
  playlistId: string, key: string,
  fetcher: typeof fetch = fetch,
): Promise<VideoItem[]> {
  const url = new URL(YT_API);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('maxResults', String(YT_API_POLICY.maxResults));
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('key', key);
  const r = await fetcher(url.href, {signal: AbortSignal.timeout(YT_API_POLICY.timeoutMs)});
  if (!r.ok) {
    // Sebab dari Google dibawa apa adanya supaya tidak menebak.
    const body = await r.text().catch(() => '');
    const bersih = body.replace(/\s+/g, ' ').trim().slice(0, 180);
    throw Error('YOUTUBE_API_' + r.status + (bersih ? ' — ' + bersih : ''));
  }
  return mapApiResponse(await r.json().catch(() => null));
}

/** Dipakai syncYoutube: pilih jalur API bila kunci ada; kalau tidak, jelaskan alasannya. */
export async function pullYoutube(db: Client, playlistId: string, master: string | undefined, fetcher?: typeof fetch) {
  const key = await apiKey(db, master);
  if (!key) throw Error('YOUTUBE_API_KEY_REQUIRED');
  return fetchPlaylistViaApi(playlistId, key, fetcher);
}
