import type {Client} from '@libsql/client';
import {peekFeed} from './rss-runtime';

export type PeekItem = {title: string; link: string | null; normalized: string | null; urlError: string | null; dateRaw: string | null; published: string | null; externalId: string | null};
export type Peek = (url: string, limit?: number) => Promise<PeekItem[]>;

/**
 * Diagnosa tarikan — BACA SAJA.
 * Tidak ada INSERT/UPDATE/DELETE, tidak ada artikel yang diterbitkan.
 * Tujuan: menjawab "kenapa 0 berita baru" dengan angka, bukan dugaan.
 */
export type DiagnoseItem = {
  title: string; state: 'siap' | 'duplikat_url' | 'duplikat_identitas' | 'url_invalid' | 'judul_kosong';
  dateOk: boolean; published: string | null; dateRaw: string | null;
};
export type DiagnoseSource = {
  id: string; name: string; feedUrl: string | null; ok: boolean; error?: string;
  feedItems: number; counts: Record<DiagnoseItem['state'], number>;
  inWindow: number | null; samples: DiagnoseItem[];
};
export type DiagnoseResult = {
  at: string; windowHours: number; sources: DiagnoseSource[];
  totals: {feedItems: number; siap: number; duplikat: number; tidak_valid: number};
  verdict: string;
};

const STATE: DiagnoseItem['state'][] = ['siap', 'duplikat_url', 'duplikat_identitas', 'url_invalid', 'judul_kosong'];

export async function diagnosePull(db: Client, opts: {limit?: number; windowHours?: number; now?: number; peek?: Peek} = {}): Promise<DiagnoseResult> {
  const now = opts.now ?? Date.now();
  const windowHours = Math.min(168, Math.max(1, opts.windowHours ?? 48));
  const limit = Math.min(25, Math.max(1, opts.limit ?? 12));
  const since = new Date(now - windowHours * 3600000).toISOString();
  const rows = (await db.execute({
    sql: "SELECT id,name,feed_url,rights_status FROM hub_sources WHERE source_kind='rss' AND is_active=1 AND discovered_type='rss' AND feed_url IS NOT NULL AND rights_status!='unknown' ORDER BY updated_at DESC LIMIT ?",
    args: [limit],
  })).rows;

  const sources: DiagnoseSource[] = [];
  for (const r of rows) {
    const id = String(r.id), name = String(r.name || ''), feedUrl = r.feed_url ? String(r.feed_url) : null;
    const counts = {siap: 0, duplikat_url: 0, duplikat_identitas: 0, url_invalid: 0, judul_kosong: 0} as Record<DiagnoseItem['state'], number>;
    const samples: DiagnoseItem[] = [];
    let feedItems = 0, inWindow: number | null = null;
    try {
      const items = await (opts.peek ?? (peekFeed as unknown as Peek))(feedUrl || '');
      feedItems = items.length;
      for (const it of items) {
        let state: DiagnoseItem['state'] = 'siap';
        if (!it.normalized) state = 'url_invalid';
        else if (!it.title) state = 'judul_kosong';
        else {
          const byUrl = (await db.execute({sql: 'SELECT id FROM hub_items WHERE source_id=? AND normalized_original_url=? LIMIT 1', args: [id, it.normalized]})).rows.length > 0;
          if (byUrl) state = 'duplikat_url';
          else if (it.externalId) {
            const byId = (await db.execute({sql: 'SELECT id FROM hub_items WHERE source_id=? AND identity_key=? LIMIT 1', args: [id, `guid:${it.externalId}`]})).rows.length > 0;
            if (byId) state = 'duplikat_identitas';
          }
        }
        counts[state] += 1;
        if (samples.length < 3) samples.push({title: it.title.slice(0, 120), state, dateOk: !!it.published, published: it.published, dateRaw: it.dateRaw ? String(it.dateRaw).slice(0, 60) : null});
      }
      try {
        inWindow = Number((await db.execute({sql: 'SELECT count(*) n FROM hub_items WHERE source_id=? AND first_seen_at>=?', args: [id, since]})).rows[0]?.n || 0);
      } catch { inWindow = null; }
      sources.push({id, name, feedUrl, ok: true, feedItems, counts, inWindow, samples});
    } catch (e) {
      const code = (e instanceof Error ? e.message : '').replace(/[^A-Z0-9_]/g, '').slice(0, 40) || 'RSS_ERROR';
      sources.push({id, name, feedUrl, ok: false, error: code, feedItems: 0, counts, inWindow, samples});
    }
  }

  const totals = sources.reduce((a, s) => ({
    feedItems: a.feedItems + s.feedItems,
    siap: a.siap + s.counts.siap,
    duplikat: a.duplikat + s.counts.duplikat_url + s.counts.duplikat_identitas,
    tidak_valid: a.tidak_valid + s.counts.url_invalid + s.counts.judul_kosong,
  }), {feedItems: 0, siap: 0, duplikat: 0, tidak_valid: 0});

  const failed = sources.filter(s => !s.ok).length;
  const verdict = !sources.length
    ? 'Tidak ada sumber RSS aktif dengan hak yang jelas — tidak ada yang bisa diperiksa.'
    : totals.feedItems === 0 && failed
      ? `Semua feed gagal dibaca (${failed} sumber). Periksa kode error per sumber.`
      : totals.siap > 0
        ? `Ada ${totals.siap} berita baru di feed yang belum ada di database — putaran berikutnya akan menariknya.`
        : `Semua ${totals.feedItems} item teratas feed sudah ada di database (duplikat). Ini sebabnya ditarik 0: bukan kerusakan, melainkan tidak ada artikel baru sejak tarikan terakhir.`
      ;

  return {at: new Date(now).toISOString(), windowHours, sources, totals, verdict};
}

export {STATE};
