'use client';
import {useState} from 'react';

type Props = {id: string; name: string; rightsStatus: string; active: boolean; onChanged?: () => void};

/** Kontrol hak sumber per baris di RSS Manager. Keputusan hak milik pemilik, bukan sistem. */
export default function SourceRightsActions({id, name, rightsStatus, active, onChanged}: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const confirmed = rightsStatus === 'permission_confirmed';

  async function mark(status: 'permission_confirmed' | 'metadata_only') {
    const text = status === 'permission_confirmed'
      ? `Tandai "${name}" sebagai PERMISSION CONFIRMED?\n\nHanya lanjutkan bila Anda sudah memastikan sumber ini mengizinkan pengambilan dan penerbitan.\n\nKetik: TANDAI HAK SUMBER`
      : `Turunkan "${name}" ke metadata_only (tidak diterbitkan otomatis)?`;
    if (!window.confirm(text)) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/hub/sources', {method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', 'X-Hub-Request': '1'},
        body: JSON.stringify({action: 'rights', id, status, confirm: 'TANDAI HAK SUMBER'})});
      const j = await r.json().catch(() => ({error: 'Respons tidak terbaca'}));
      if (!r.ok) throw Error(j.error || 'Gagal menyimpan');
      setMsg('tersimpan');
      onChanged?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal'); }
    finally { setBusy(false); }
  }

  return <div className="tiny">
    {!confirmed
      ? <button className="button secondary" type="button" disabled={busy || !active}
          title={active ? undefined : 'Aktifkan sumber lebih dulu'} onClick={() => void mark('permission_confirmed')}>Tandai hak terkonfirmasi</button>
      : <button className="button secondary" type="button" disabled={busy} onClick={() => void mark('metadata_only')}>Turunkan ke metadata_only</button>}
    {msg && <> <span>{msg}</span></>}
  </div>;
}
