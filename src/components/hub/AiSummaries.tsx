'use client';
import React, {useCallback, useEffect, useRef, useState} from 'react';

type Status = {ready: boolean; stored: number; kindCounts: Record<string, number>; applied: number; quota?: {attemptsToday: number; remainingToday: number}};
type Plan = {scanned: number; aiPending: number; extractivePending: number; existingEditorialIncluded?: number; reasons: Record<string, number>; estimatedTokensNextRun: number};
type Ai = {consent: boolean; keysConfigured: string[]; quotaPerDay: number};
type Row = {id: string; kind: string; summary: string; provider: string | null; updatedAt: string; appliedAt: string | null; title: string; version: number; reviewState: string; publishedAt: string | null; sourceUrl: string; sourceName: string};

async function call(query = '', body?: Record<string, unknown>) {
  const r = await fetch('/api/hub/summaries' + (body ? '' : query), {method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: {'X-Hub-Request': '1', ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Permintaan gagal');
  return j;
}
const at = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Makassar'}).format(new Date(v)) + ' WITA' : 'Tidak tersedia');
const KIND: Record<string, string> = {extractive: 'Ekstraktif · 0 token', ai: 'AI · hemat token', reuse: 'Dipakai ulang dari cache'};
const REASON: Record<string, string> = {region_outside: 'di luar Bali/NTB/NTT', date_invalid: 'tanggal tidak valid/terlalu lama', rights_unconfirmed: 'hak metadata belum dikonfirmasi', editorial_present: 'ringkasan editorial sudah ada', risk_needs_review: 'sinyal risiko menunggu tinjauan', text_too_short: 'metadata terlalu pendek', state_blocked: 'status ditolak/identitas meragukan', cached: 'sudah punya ringkasan terbaru', stale: 'perlu diperbarui', duplicate: 'teks sama dengan kandidat lain'};

export default function SummaryManager({onCompleted}: {onCompleted?: () => void}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ai, setAi] = useState<Ai | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [stat, setStat] = useState('');
  const [includeExisting, setIncludeExisting] = useState(false);
  const stop = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await call();
      setStatus(d.status); setPlan(d.plan); setAi(d.ai);
      const l = await call('?view=list');
      setRows(l.items || []);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function prepare() {
    if (!window.confirm('Siapkan tabel ringkasan dan cache AI di Preview? Tidak menghapus data dan tidak mengubah berita.')) return;
    setBusy(true);
    try { await call('', {action: 'prepare', confirm: 'PREPARE SUMMARIES'}); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Gagal'); } finally { setBusy(false); }
  }

  async function generate() {
    const confirmText = includeExisting
      ? 'Buat saran pembanding juga untuk berita yang SUDAH punya ringkasan editorial? Saran tidak akan menimpa apa pun; Anda membandingkan lalu memilih. Hanya judul dan cuplikan publik yang dikirim ke provider gratis.'
      : 'Buat ringkasan untuk kandidat Bali/NTB/NTT yang lolos syarat? Hanya judul dan cuplikan publik yang dikirim ke provider gratis; artikel lengkap tidak diambil. Ringkasan disimpan sebagai saran, bukan mengganti berita.';
    if (!window.confirm(confirmText)) return;
    setBusy(true); stop.current = false; setError(''); setStat('');
    let totalAi = 0, totalTok = 0, totalSaved = 0, rounds = 0, written = 0;
    try {
      while (!stop.current && rounds < 40) {
        const r = await call('', {action: 'batch', confirm: includeExisting ? 'FORCE SUMMARY' : 'GENERATE SUMMARIES', includeExisting, maxItems: 5});
        rounds += 1; totalAi += r.aiCalls || 0; totalTok += r.tokensUsedTotal || 0; totalSaved += r.tokensSaved || 0; written += r.written || 0;
        setProgress(`${written} ringkasan tersimpan · ${totalAi} panggilan AI · ~${totalTok} token terpakai · ~${totalSaved} token dihemat cache`);
        if (!r.processed || r.stopped !== 'ok' || r.remaining === 0) break;
      }
      setStat(`Selesai: ${written} ringkasan (${totalAi} panggilan AI, ~${totalTok} token, ~${totalSaved} token dihemat). Tidak ada berita yang diubah otomatis.`);
      await load(); onCompleted?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal'); } finally { setBusy(false); setProgress(''); }
  }

  async function apply(row: Row) {
    if (!window.confirm('Terapkan ringkasan ini ke kolom ringkasan editorial? Versi berita naik dan persetujuan lama tidak berlaku untuk versi baru. Suntingan manual yang sudah ada tidak ditimpa.')) return;
    setBusy(true);
    try { await call('', {action: 'apply', confirm: 'APPLY SUMMARY', id: row.id, version: row.version}); await load(); onCompleted?.(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal'); } finally { setBusy(false); }
  }

  const reasons = plan?.reasons || {};
  return <section className="panel">
    <h2>Tahap 4 · Ringkasan AI hemat token</h2>
    <p>Ringkasan dibuat hanya untuk berita <b>Bali, NTB, NTT</b> yang punya tanggal valid, hak metadata terkonfirmasi, dan belum punya ringkasan editorial. AI hanya membaca <b>judul dan cuplikan publik yang sudah tersimpan</b>—halaman artikel tidak dibuka. Jalur ekstraktif (potongan verbatim) dipakai lebih dulu sehingga banyak berita tidak memakai token sama sekali.</p>
    <div className="form-actions">
      <button className="button secondary" disabled={busy} onClick={() => void prepare()}>Siapkan tabel ringkasan</button>
      <button className="button" disabled={busy || status?.ready !== true} onClick={() => void generate()}>Buat ringkasan bertahap</button>
      {busy && <button className="button secondary" onClick={() => { stop.current = true; }}>Hentikan setelah batch ini</button>}
      <button className="button secondary" disabled={busy} onClick={() => void load()}>Muat ulang</button>
    </div>
    <div><label><input type="checkbox" checked={includeExisting} onChange={e => setIncludeExisting(e.target.checked)} /> Sertakan berita yang sudah punya ringkasan editorial—hanya untuk saran pembanding, tidak menimpa apa pun</label>
    </div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {progress && <p role="status" className="tiny">{progress}</p>}
    {stat && <p role="status" className="tiny">{stat}</p>}
    {status && !status.ready && <p className="tiny">Tabel ringkasan belum disiapkan. Tidak ada yang ditulis sebelum Anda menekan tombol persiapan.</p>}
    {ai && !ai.consent && <p className="notice error">Izin pengiriman metadata ke provider AI belum aktif. Aktifkan di Pengaturan AI setelah meninjau ketentuan provider. Tanpa izin, hanya jalur ekstraktif yang berjalan.</p>}
    {plan && <>
      <p><b>{plan.scanned}</b> kandidat diperiksa · <b>{plan.aiPending}</b> perlu AI · <b>{plan.extractivePending}</b> cukup ekstraktif · perkiraan ~{plan.estimatedTokensNextRun} token untuk batch berikutnya.{includeExisting ? '' : ` ${plan.existingEditorialIncluded ? '' : 'Berita dengan ringkasan editorial dilewati agar suntingan manual tidak tertimpa.'}`}</p>
      <p className="tiny">Kuota provider: {status?.quota ? `${status.quota.attemptsToday}/${ai?.quotaPerDay ?? 20} percobaan hari ini` : `maksimal ${ai?.quotaPerDay ?? 20}/hari`}. Cache mencegah teks yang sama dikirim dua kali. Bila kuota habis, sisa kandidat menunggu besok—tidak ada pembelian token otomatis.</p>
      {Object.keys(reasons).length > 0 && <p className="tiny">Disaring: {Object.entries(reasons).map(([k, v]) => `${REASON[k] || k} (${v})`).join(' · ')}</p>}
    </>}
    {status?.ready && <p><b>{status.stored}</b> ringkasan tersimpan · {status.applied} diterapkan pemilik. Ringkasan adalah saran; tidak ada publikasi otomatis, bukan verifikasi fakta, dan bukan penilaian kesesuaian usia.</p>}
    {rows.length > 0 && <div>{rows.map(r => <article className="article" key={r.id}>
      <h3>{r.title}</h3>
      <p>{r.summary}</p>
      <p className="tiny">{KIND[r.kind] || r.kind}{r.provider ? ` · ${r.provider}` : ''} · {at(r.updatedAt)} · {r.sourceName} · status berita: {r.reviewState}{r.appliedAt ? ' · sudah diterapkan' : ''}</p>
      {(r as any).currentEditorial && <p className="tiny">Ringkasan editorial saat ini (tidak diubah): {(r as any).currentEditorial}</p>}
      <div className="form-actions">
        {!r.appliedAt && <button className="button secondary" disabled={busy} onClick={() => void apply(r)}>Gunakan ke ringkasan editorial</button>}
        {r.sourceUrl?.startsWith('https://') && <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">Sumber</a>}
      </div>
    </article>)}</div>}
    {status?.ready && rows.length === 0 && <p>Belum ada ringkasan. Tekan “Buat ringkasan bertahap” untuk memproses maksimal 5 berita per request.</p>}
  </section>;
}
