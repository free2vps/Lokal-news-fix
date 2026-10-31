'use client';
import React, {useCallback, useEffect, useState} from 'react';

/**
 * Alat bantu LANJUTAN — pengganti tiga panel lama (Otomasi 3 jam, Autopublish, Pekerja).
 *
 * Prinsip: pemakaian sehari-hari TIDAK butuh apa pun di sini. Semua yang tampil hanya untuk
 * dua keperluan nyata: (1) mengirim ke Facebook lewat Make, (2) menelusuri masalah.
 * Tombol yang hanya menduplikasi Redaktur Otomatis dihapus.
 */
const at = (v: unknown) =>
  typeof v === 'string' && Number.isFinite(Date.parse(v))
    ? new Intl.DateTimeFormat('id-ID', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Makassar'}).format(new Date(v)) + ' WITA'
    : '—';

async function call(path: string, body?: Record<string, unknown>) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: {'X-Hub-Request': '1', ...(body ? {'Content-Type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const j = await r.json().catch(() => ({error: 'Respons tidak terbaca'}));
  if (!r.ok) throw Error(j.error || 'Permintaan gagal');
  return j;
}

export default function AdvancedTools() {
  const [social, setSocial] = useState<any>(null);
  const [auto, setAuto] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [socialToken, setSocialToken] = useState('');
  const [autoToken, setAutoToken] = useState('');

  const load = useCallback(async () => {
    const [s, a] = await Promise.allSettled([call('/api/hub/social'), call('/api/hub/automation')]);
    if (s.status === 'fulfilled') setSocial(s.value); else setSocial(null);
    if (a.status === 'fulfilled') setAuto(a.value); else setAuto(null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, fn: () => Promise<any>, note: string) {
    setBusy(key); setErr(''); setMsg('');
    try { await fn(); setMsg(note); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Gagal'); }
    finally { setBusy(''); }
  }

  return <>
    <details className="panel">
      <summary><b>Kirim ke Facebook lewat Make</b> <span className="tiny">— opsional, kalau Anda memakai Make</span></summary>
      <p className="tiny">Hub hanya menyiapkan daftar artikel siap-posting. Token Facebook tetap disimpan di Make, bukan di sini.</p>
      <p><b>Antrean:</b> {social?.pending ?? 0} menunggu · {social?.delivered ?? 0} terkirim · {social?.failed ?? 0} gagal · maks {social?.facebookMaxPerRun ?? 4} per tarikan</p>
      <div className="form-actions">
        <button className="button secondary" disabled={busy === 'social'} onClick={() => void act('social',
          async () => { const r = await call('/api/hub/social', {action: 'issueToken', confirm: 'ISSUE SOCIAL TOKEN', label: 'make.com'}); if (r?.token) setSocialToken(r.token); },
          'Token Make dibuat. Salin sekarang — tidak ditampilkan lagi.')}>Buat token Make</button>
      </div>
      {socialToken && <p role="status" className="tiny"><b>Token Make:</b> <code>{socialToken}</code></p>}
      {!!social?.tokens?.length && <ul className="tiny">{social.tokens.map((t: any) => <li key={t.id}>{t.label} · dibuat {at(t.createdAt)} · {t.revoked ? 'dicabut' : `dipakai ${at(t.lastUsedAt)}`}
        {!t.revoked && <button className="button secondary" disabled={busy === 'rev'} onClick={() => void act('rev',
          () => call('/api/hub/social', {action: 'revokeToken', confirm: 'REVOKE SOCIAL TOKEN', id: t.id}), 'Token Make dicabut.')}>Cabut</button>}</li>)}</ul>}
      <p className="tiny">Rincian langkah di Make ada di <code>PASANG-SEKALI.md</code> (Skenario B). Kalau tidak memakai Facebook, abaikan bagian ini.</p>
    </details>

    <details className="panel">
      <summary><b>Penjadwal otomatis</b> <span className="tiny">— GitHub Actions atau Make memanggil Hub tiap 3 jam</span></summary>
      <p><b>Putaran terjadwal terakhir:</b> {auto?.last ? `${at(auto.last.at)} · ${auto.last.status}` : 'belum pernah — kemungkinan penjadwal belum dipasang'}</p>
      <p className="tiny">Token otomasi biasanya sudah terbit saat Anda menekan <b>Sekali Atur</b>. Buat lagi hanya bila token itu hilang.</p>
      <div className="form-actions">
        <button className="button secondary" disabled={busy === 'auto'} onClick={() => void act('auto',
          async () => { const r = await call('/api/hub/automation', {action: 'issueToken', confirm: 'ISSUE AUTOMATION TOKEN', label: 'penjadwal 3 jam'}); if (r?.token) setAutoToken(r.token); },
          'Token otomasi dibuat. Salin sekarang — tidak ditampilkan lagi.')}>Buat token otomasi</button>
      </div>
      {autoToken && <p role="status" className="tiny"><b>Token otomasi:</b> <code>{autoToken}</code></p>}
      {!!auto?.tokens?.length && <ul className="tiny">{auto.tokens.map((t: any) => <li key={t.id}>{t.label} · dibuat {at(t.createdAt)} · {t.revoked ? 'dicabut' : `dipakai ${at(t.lastUsedAt)}`}
        {!t.revoked && <button className="button secondary" disabled={busy === 'revauto'} onClick={() => void act('revauto',
          () => call('/api/hub/automation', {action: 'revokeToken', confirm: 'REVOKE AUTOMATION TOKEN', id: t.id}), 'Token otomasi dicabut.')}>Cabut</button>}</li>)}</ul>}
    </details>

    <details className="panel">
      <summary><b>Menelusuri masalah</b> <span className="tiny">— dua pemeriksaan aman, tidak menerbitkan apa pun</span></summary>
      <div className="form-actions">
        <button className="button secondary" disabled={busy === 'dry'} onClick={() => void act('dry',
          () => call('/api/hub/publish', {action: 'dryRun', confirm: 'DRY RUN PUBLISH'}),
          'Uji selesai. Tidak ada artikel yang dikirim.')}>Uji pengiriman (tanpa kirim)</button>
        <button className="button secondary" disabled={busy === 'tick'} onClick={() => void act('tick',
          async () => { try { await call('/api/hub/worker', {action: 'tick', confirm: 'RUN WORKER', maxTasks: 1}); } catch { await call('/api/hub/worker', {action: 'prepare', confirm: 'PREPARE WORKER'}); } },
          'Pekerja latar dijalankan satu langkah.')}>Proses satu tugas latar</button>
      </div>
      <p className="tiny">"Uji pengiriman" hanya menghitung artikel yang akan terbit dan menunjukkan alasan yang tertahan. "Proses satu tugas latar" mengurus antrean internal (profil/ringkasan tertunda). Keduanya tidak mengubah isi portal.</p>
    </details>

    {msg && <p role="status" className="tiny">{msg}</p>}
    {err && <p role="alert" className="notice error">{err}</p>}
  </>;
}
