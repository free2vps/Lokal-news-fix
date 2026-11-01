'use client';
import {useCallback, useEffect, useState} from 'react';

type Entry = {sourceId: string; from: string | null; to: string; at: string};

export default function SourceRightsLog() {
  const [log, setLog] = useState<Entry[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/hub/sources', {credentials: 'same-origin', cache: 'no-store'});
      const j = await r.json();
      if (!r.ok) throw Error(j.error || 'Gagal memuat');
      setLog((j.rightsLog ?? []) as Entry[]);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <p className="tiny" role="alert">{err}</p>;
  if (!log.length) return <p className="tiny">Belum ada perubahan hak sumber.</p>;
  return <details><summary>Riwayat perubahan hak ({log.length})</summary>
    <table><thead><tr><th>Sumber</th><th>Dari</th><th>Ke</th><th>Waktu</th></tr></thead>
      <tbody>{log.map((l, i) => <tr key={i}><td className="tiny">{l.sourceId.slice(0, 8)}…</td><td>{l.from || '—'}</td><td>{l.to}</td><td className="tiny">{l.at}</td></tr>)}</tbody></table>
    <p className="tiny">Setiap perubahan dicatat. Menandai hak tidak menyalakan redaktur otomatis; saklar tetap terpisah.</p>
  </details>;
}
