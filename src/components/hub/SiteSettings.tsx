'use client';
import { useCallback, useEffect, useState } from 'react';

type Field = { key: string; label: string; hint: string };
const FIELDS: Field[] = [
  { key: 'social_facebook', label: 'Facebook', hint: 'https://facebook.com/namaakun' },
  { key: 'social_instagram', label: 'Instagram', hint: 'https://instagram.com/namaakun' },
  { key: 'social_x', label: 'X', hint: 'https://x.com/namaakun' },
  { key: 'social_tiktok', label: 'TikTok', hint: 'https://tiktok.com/@namaakun' },
  { key: 'social_youtube', label: 'YouTube', hint: 'https://youtube.com/@namaakun' },
  { key: 'social_whatsapp', label: 'WhatsApp Channel', hint: 'https://whatsapp.com/channel/...' },
];

async function call<T>(body?: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/hub/site-settings', {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-Hub-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Permintaan gagal.');
  return json as T;
}

/**
 * Pengaturan situs: tautan media sosial yang tampil di footer portal.
 * Disimpan di database Hub, bukan env — ikut pindah saat hosting diganti.
 * Kosongkan sebuah kolom untuk menyembunyikan tombolnya (lebih baik daripada tautan mati).
 */
export default function SiteSettings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await call<{ social: Record<string, string> }>();
      setValues(data.social ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      await call({ ...values });
      setMessage('Tersimpan. Footer portal diperbarui.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="panel"><p>Memuat pengaturan situs…</p></div>;

  return (
    <div className="panel">
      <h2>Media sosial</h2>
      <p>Tautan ini tampil sebagai tombol di footer portal. Isi hanya akun yang benar-benar ada —
        kolom kosong otomatis tidak ditampilkan.</p>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              type="url"
              inputMode="url"
              maxLength={300}
              placeholder={f.hint}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        <div>
          <button className="button" type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <p className="tiny">Tersimpan di database Hub. Tidak perlu mengubah pengaturan hosting.</p>
    </div>
  );
}
