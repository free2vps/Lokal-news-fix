'use client';
import {useState} from 'react';

export type RssSource = {
  id: string; name: string; jurisdiction: string; requestedUrl: string;
  sourceKind: string; discoveredType: string; active: boolean; rightsStatus: string; itemCount: number;
  audit?: {checkedAt: string | null; feedVerified?: boolean} | null;
};

function safeExternal(raw: string) {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
}
function when(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'belum pernah';
  return new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Makassar'}).format(new Date(value)) + ' WITA';
}

/**
 * RSS Manager versi satu saklar.
 * Hanya ada satu kendali per sumber: Aktif. Menyalakan = boleh diambil & diterbitkan,
 * dan sekaligus memvalidasi feed di sisi server. Tidak ada tombol validasi/hak/sinkron terpisah.
 */
export default function RssManager({sources, onChanged}:{sources: RssSource[] | null; onChanged: () => Promise<void> | void}) {
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function toggle(source: RssSource, next: boolean) {
    setBusy(source.id);
    setMsg(m => ({...m, [source.id]: next ? 'Memeriksa feed…' : 'Mematikan…'}));
    try {
      const r = await fetch('/api/hub/workspace', {method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', 'X-Hub-Request': '1'},
        body: JSON.stringify({action: 'toggleSource', sourceId: source.id, active: next})});
      const j = await r.json().catch(() => ({error: 'Respons tidak terbaca'}));
      if (!r.ok) throw Error(String(j.error || 'Gagal'));
      setMsg(m => ({...m, [source.id]: next ? 'Aktif.' : 'Nonaktif.'}));
      await onChanged();
    } catch (e) {
      setMsg(m => ({...m, [source.id]: (e instanceof Error ? e.message : 'Gagal') + (next ? ' — sumber tetap nonaktif.' : '')}));
    } finally { setBusy(''); }
  }

  if (sources === null) return <div className="panel">Memuat sumber…</div>;

  return <div className="panel">
    <h2>Sumber ({sources.length})</h2>
    <p className="tiny">Nyalakan sumber yang <b>Anda nilai boleh</b> diambil dan diterbitkan. Menyalakan sekaligus memeriksa feed-nya; kalau feed tidak terbaca, sumber tetap mati.</p>
    <table>
      <thead><tr><th>Sumber</th><th>Berita</th><th>Aktif</th></tr></thead>
      <tbody>
        {sources.map(s => {
          const noFeed = s.sourceKind !== 'rss';
          return <tr key={s.id}>
            <td>
              <b>{s.name}</b>{s.jurisdiction ? <span className="muted"> · {s.jurisdiction}</span> : null}<br />
              <a className="source-url" href={safeExternal(s.requestedUrl)} target="_blank" rel="noopener noreferrer">{s.requestedUrl}</a>
              {noFeed && <div className="tiny muted">Situs, bukan feed — tidak bisa dinyalakan.</div>}
              <details className="tiny"><summary>Detail</summary>
                <div>Hak tercatat: {s.rightsStatus === 'permission_confirmed' ? 'boleh (pernyataan Anda)' : s.rightsStatus === 'metadata_only' ? 'metadata saja' : 'belum dinyatakan'}</div>
                <div>Jenis: {s.discoveredType === 'rss' ? 'feed RSS' : s.discoveredType === 'unverified' ? 'belum terverifikasi' : s.discoveredType}</div>
                <div>Pemeriksaan terakhir: {when(s.audit?.checkedAt)}</div>
              </details>
            </td>
            <td>{s.itemCount}</td>
            <td>
              <label className="tiny" style={{display: 'inline-flex', gap: 6, alignItems: 'center'}}>
                <input type="checkbox" checked={s.active} disabled={busy === s.id || noFeed}
                  onChange={e => void toggle(s, e.target.checked)} />
                {busy === s.id ? '…' : s.active ? 'Aktif' : 'Mati'}
              </label>
              {msg[s.id] && <div className="tiny muted">{msg[s.id]}</div>}
            </td>
          </tr>;
        })}
        {sources.length === 0 && <tr><td colSpan={3}>Belum ada sumber. Tambahkan feed RSS di bagian bawah.</td></tr>}
      </tbody>
    </table>
  </div>;
}
