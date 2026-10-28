'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import HubModules, {SourceActions} from './HubModules';
import sourceManifest from '../../../config/ntb-government-sources.json';

type Audit = { checkedAt: string; robots: string | null; robotsReason: string | null; pageStatus: number | null; pageReason: string | null; feedVerified: boolean };
type Source = { id: string; name: string; jurisdiction: string; region: string; requestedUrl: string; sourceKind: string; discoveredType: string; feedUrl: string | null; rightsStatus: string; active: boolean; itemCount: number; audit: Audit | null };
type News = { id: string; sourceName: string; sourceUrl: string; sourceTitle: string; sourceSnippet: string | null; sourcePublishedAt: string | null; sourceDateRaw: string | null; firstSeenAt: string; editorialTitle: string | null; editorialSummary: string | null; editorialCategory: string | null; version: number; reviewState: string; possibleDuplicates: number };
type Ai = { keysReadable?: boolean; policy?: {allowPublic:boolean;groqFree:boolean}; masterKeyReady: boolean; runtime: string; providers: { provider: string; model: string; keyConfigured: boolean; updatedAt: string; use: string }[] };
type Auth = { configured: boolean; authenticated: boolean; setupAvailable: boolean };
const tabs = ['Ringkasan', 'RSS Manager', 'Rekomendasi', 'Berita', 'X Trending', 'YouTube Music', 'Sync Logs', 'API Integration', 'Pengaturan AI', 'Pengaturan'] as const;
type Tab = typeof tabs[number];

async function api<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/hub/' + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Hub-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Permintaan gagal.');
  return json as T;
}
function formatDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Belum tersedia';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Makassar' }).format(new Date(value)) + ' WITA';
}
function safeExternal(raw: string) { try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined; } catch { return undefined; } }
function auditText(audit: Audit | null, sourceId: string) {
  if (!audit) return 'Belum ada pemeriksaan';
  if (sourceId === 'gov-ntb-lombok-timur' && audit.pageStatus === 200) return 'Daftar HTML terbuka; pola tautan ditemukan, tanggal belum terlihat';
  if (audit.robots === 'blocked') return 'robots.txt merespons 403; akses belum dipastikan';
  if (audit.robots === 'unknown' && audit.robotsReason === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return 'Sertifikat HTTPS tidak dapat diverifikasi';
  if (audit.robots === 'unknown' && audit.robotsReason === 'request-timeout') return 'Pemeriksaan aturan akses melewati batas waktu';
  if (audit.pageStatus === 403) return 'Halaman merespons 403; tidak dilewati';
  if (audit.pageStatus === 200) return 'Halaman dapat dibuka; format artikel belum tervalidasi';
  return 'Akses atau aturan belum dapat dipastikan';
}

export default function HubApp({ staticPreviewEnabled = false, bootstrapEnabled = false }: { staticPreviewEnabled?: boolean; bootstrapEnabled?: boolean }) {
  const [staticPreview, setStaticPreview] = useState(false);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [authError, setAuthError] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [bootstrapError, setBootstrapError] = useState('');
  const [bootstrapConfirmed, setBootstrapConfirmed] = useState(false);
  const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false); const [tab, setTab] = useState<Tab>('Ringkasan');
  const [sources, setSources] = useState<Source[] | null>(null); const [news, setNews] = useState<News[] | null>(null);
  const [offset,setOffset]=useState(0); const [total,setTotal]=useState(0);
  const [ai, setAi] = useState<Ai | null>(null); const [loadError, setLoadError] = useState('');
  const checkAuth = useCallback(async () => {
    try { setAuthError(''); setAuth(await api<Auth>('auth/status')); }
    catch (error) { setAuthError(error instanceof Error ? error.message : 'Hub belum siap.'); }
  }, []);
  const reload = useCallback(async () => {
    const results = await Promise.allSettled([api<{ sources: Source[] }>('sources'), api<{ items: News[];total:number }>('news?offset='+offset), api<Ai>('ai-settings')]);
    const errors: string[] = [];
    if (results[0].status === 'fulfilled') setSources(results[0].value.sources); else errors.push('sumber');
    if (results[1].status === 'fulfilled') {setNews(results[1].value.items);setTotal(results[1].value.total);} else errors.push('berita');
    if (results[2].status === 'fulfilled') setAi(results[2].value); else errors.push('pengaturan AI');
    setLoadError(errors.length ? 'Belum dapat memuat: ' + errors.join(', ') + '. Data terakhir tidak dihapus.' : '');
  }, [offset]);
  useEffect(() => { void checkAuth(); }, [checkAuth]);
  useEffect(() => { if (auth?.authenticated) void reload(); }, [auth?.authenticated, reload]);
  async function signIn(event: FormEvent) {
    event.preventDefault(); setAuthError('');
    if (!auth?.configured && password !== confirmPassword) { setAuthError('Konfirmasi password tidak sama.'); return; }
    setBusy(true);
    try {
      await api(auth?.configured ? 'auth/login' : 'auth/setup', auth?.configured ? { password } : { password, token: setupToken });
      setPassword(''); setConfirmPassword(''); setSetupToken(''); await checkAuth();
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Login gagal.'); }
    finally { setBusy(false); }
  }
  async function initializePreview(event: FormEvent) {
    event.preventDefault(); setBootstrapError('');
    if (!bootstrapConfirmed) { setBootstrapError('Pastikan database baru dan kosong.'); return; }
    if (password !== confirmPassword) { setBootstrapError('Konfirmasi password tidak sama.'); return; }
    setBusy(true);
    let databaseInitialized = false;
    try {
      await api('bootstrap', { token: bootstrapToken, confirm: 'SIAPKAN DATABASE PREVIEW' });
      databaseInitialized = true;
      await api('auth/setup', { token: bootstrapToken, password });
      setPassword(''); setConfirmPassword(''); setSetupToken(''); setBootstrapToken(''); setBootstrapConfirmed(false);
      await checkAuth();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Inisialisasi belum berhasil.';
      if (databaseInitialized) {
        // Schema may have committed even if account setup or its response failed.
        // Carry the token in component memory only, so the normal setup form can retry.
        setSetupToken(bootstrapToken); setBootstrapToken('');
        await checkAuth();
        setAuthError('Database sudah disiapkan, tetapi akun belum dapat dipastikan: ' + message + ' Lanjutkan lewat formulir akun atau masuk.');
      } else {
        setBootstrapError(message);
      }
    } finally { setBusy(false); }
  }
  async function logout() {
    try { await api('auth/logout', {}); }
    catch { setLoadError('Logout gagal; sesi mungkin masih aktif. Periksa koneksi dan coba lagi.'); return; }
    setSources(null); setNews(null); setAi(null); setAuth(null); setPassword(''); setConfirmPassword(''); setSetupToken(''); await checkAuth();
  }
  if (staticPreview && staticPreviewEnabled && !auth?.authenticated) return <StaticHubPreview onClose={() => setStaticPreview(false)} />;
  if (!auth?.authenticated) return <div className="hub-root"><div className="login-wrap"><div className="login-card">
    <div className="brand"><b>P</b> Portal Content Hub</div><h1>{auth?.configured ? 'Masuk dashboard' : 'Pengaturan Content Hub'}</h1>
    <p>Hub berada di dalam proyek website. Data dan tindakan hanya tersedia setelah autentikasi.</p>
    {authError && <div role="alert" className="notice error">{authError}</div>}
    {!auth && !authError && <p>Memeriksa konfigurasi…</p>}
    {auth && !auth.configured && !auth.setupAvailable && <div className="notice warning">Database siap, tetapi token pengaturan awal belum disediakan di backend. Tidak ada akun yang dibuat otomatis.</div>}
    {auth && (auth.configured || auth.setupAvailable) && <form className="form-grid" onSubmit={signIn}>
      {!auth.configured && <label>Token pengaturan awal<input required type="password" autoComplete="off" value={setupToken} onChange={e => setSetupToken(e.target.value)} /></label>}
      <label>Password administrator<input required type="password" minLength={12} maxLength={200} autoComplete={auth.configured ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {!auth.configured && <label>Ulangi password administrator<input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>}
      {!auth.configured && <small>Password minimal 12 karakter. Token hanya digunakan untuk membuat akun pertama.</small>}
      <button className="button" disabled={busy}>{busy ? 'Memeriksa…' : auth.configured ? 'Masuk dashboard →' : 'Buat akun administrator'}</button>
    </form>}
    {authError && <p><button className="button secondary" onClick={() => void checkAuth()}>Coba lagi</button></p>}
    {bootstrapEnabled && authError && !auth && <details className="panel"><summary>Siapkan database Preview baru</summary>
      <p>Hanya untuk database Turso baru dan kosong pada branch <b>webhub</b>. Satu langkah ini menyiapkan skema, 11 sumber nonaktif dan akun administrator baru. Tidak ada data lama yang dipindahkan.</p>
      <form className="form-grid" onSubmit={initializePreview}>
        <label>Token pengaturan awal<input required type="password" minLength={43} maxLength={128} pattern="[A-Za-z0-9_-]+" autoComplete="off" value={bootstrapToken} onChange={e => setBootstrapToken(e.target.value)} /></label>
        <label>Password administrator<input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Ulangi password administrator<input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}><input style={{ width: 16, height: 16, flexShrink: 0 }} type="checkbox" required checked={bootstrapConfirmed} onChange={e => setBootstrapConfirmed(e.target.checked)} /> Saya memastikan database yang dituju baru, kosong dan khusus Preview.</label>
        {bootstrapError && <div role="alert" className="notice error">{bootstrapError}</div>}
        <button className="button" disabled={busy}>{busy ? 'Menyiapkan…' : 'Siapkan Hub dan buat akun'}</button>
      </form>
    </details>}
    {staticPreviewEnabled && authError && <div className="notice warning"><b>Pratinjau tanpa database.</b> Anda dapat melihat menu dan 11 sumber dari berkas konfigurasi. Ini bukan sesi admin, tidak menampilkan data Hub lama, dan tidak menyimpan perubahan.<p><button className="button secondary" type="button" onClick={() => setStaticPreview(true)}>Lihat tampilan Hub →</button></p></div>}
  </div></div></div>;
  return <div className="hub-root"><aside><div className="brand"><b>P</b> Portal Hub</div><nav aria-label="Menu Content Hub">{tabs.map(t => <button type="button" key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav><div className="sidebar-note">CONTENT OPERATIONS<br />Asia/Makassar · WITA<br />Preview Hub · scheduler nonaktif</div></aside>
    <main className="workspace"><header><div><div className="eyebrow">Workspace / Content Hub</div><h1>{tab}</h1><div className="muted">Pusat pengelolaan konten untuk portal Anda</div></div><div className="row"><button className="button secondary" onClick={() => void reload()}>↻ Perbarui</button><button className="button" onClick={() => void logout()}>Keluar</button></div></header>
      {loadError && <div role="alert" className="notice error">{loadError}</div>}
      {tab === 'Ringkasan' && <><div className="notice warning"><b>Hub Preview.</b> Daftar sumber dan alur tinjauan menggunakan database Hub yang terkonfigurasi. Sinkronisasi metadata tersedia secara manual setelah izin sumber. Publikasi dan jadwal otomatis tetap nonaktif. Saran AI manual tersedia setelah skema, kunci dan izin siap.</div><div className="cards">
        <div className="card"><span className="muted">Sumber tercatat</span><strong>{sources === null ? '—' : sources.length}</strong></div><div className="card"><span className="muted">Sumber aktif</span><strong>{sources === null ? '—' : sources.filter(s => s.active).length}</strong></div><div className="card"><span className="muted">Total kandidat tersimpan</span><strong>{news === null ? '—' : total}</strong></div><div className="card"><span className="muted">Disetujui dalam tampilan</span><strong>{news === null ? '—' : news.filter(n => n.reviewState === 'approved').length}</strong></div>
      </div><div className="panel"><h2>Status pekerjaan</h2><p>Registrasi 11 sumber resmi dilakukan dengan aman dan tidak menyebut halaman HTML sebagai RSS. Perubahan redaksi dilindungi versi; publikasi tetap nonaktif. Data migrasi dapat ditinjau dan diedit.</p><button className="button secondary" onClick={() => setTab('RSS Manager')}>Lihat sumber →</button></div></>}
      {tab === 'RSS Manager' && <><div className="notice">Sumber resmi pemerintah disimpan sebagai <b>situs</b>, bukan RSS, sampai feed benar-benar ditemukan dan diverifikasi. Sumber baru disimpan nonaktif; hak penggunaan dan akses dapat berubah.</div><details className="panel"><summary>+ Tambah sumber secara manual</summary><SourceForm onChanged={reload} /></details><div className="panel"><h2>Sumber terdaftar {sources && `(${sources.length})`}</h2><table><thead><tr><th>Sumber / URL</th><th>Jenis & status</th><th>Pemeriksaan awal</th><th>Berita</th></tr></thead><tbody>{sources?.map(source => <tr key={source.id}><td><b>{source.name}</b><br /><span className="muted">{source.jurisdiction}</span><br /><a className="source-url" href={safeExternal(source.requestedUrl)} target="_blank" rel="noopener noreferrer">{source.requestedUrl}</a></td><td><span className="badge">{source.sourceKind === 'government_website' ? 'Situs pemerintah' : source.discoveredType === 'rss' ? 'RSS terverifikasi' : 'RSS yang diajukan'}</span><br /><br /><span className="badge warn">{source.active ? 'Aktif' : 'Nonaktif'}</span><br /><span className="tiny muted">{source.discoveredType === 'unverified' ? 'Format belum diverifikasi' : source.discoveredType}</span></td><td>{auditText(source.audit, source.id)}<br /><span className="tiny muted">{source.audit ? formatDate(source.audit.checkedAt) : ''}</span><br /><span className="tiny muted">{source.audit?.feedVerified ? 'RSS terverifikasi' : 'RSS belum terbukti'}</span></td><td>{source.itemCount}{source.sourceKind==='rss'&&<SourceActions id={source.id} active={source.active} verified={source.discoveredType==='rss'} onChanged={reload}/>}</td></tr>)}{sources?.length === 0 && <tr><td colSpan={4}>Belum ada sumber tercatat.</td></tr>}{sources === null && <tr><td colSpan={4}>Memuat sumber…</td></tr>}</tbody></table><p className="tiny">Status tersebut adalah hasil satu kali pemeriksaan dari lingkungan ini, bukan jaminan kondisi situs saat ini atau izin menyalin artikel.</p></div></>}
      {tab === 'Berita' && <><div className="form-actions"><button className="button secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>Sebelumnya</button><span>{total?offset+1:0}–{Math.min(offset+100,total)} / {total}</span><button className="button secondary" disabled={offset+100>=total} onClick={()=>setOffset(offset+100)}>Berikutnya</button></div><div className="notice">Setiap revisi harus disetujui. Tanggal terbit tidak diambil dari waktu penemuan; identitas yang meragukan dan tanggal yang belum jelas menghalangi persetujuan. Publikasi masih dinonaktifkan.</div>{news === null ? <div className="panel">Memuat berita…</div> : news.length === 0 ? <div className="panel"><h2>Belum ada kandidat tersimpan</h2><p>Kolektor belum diintegrasikan atau diaktifkan. Tidak ada berita contoh yang ditampilkan.</p></div> : <div className="article-grid">{news.map(item => <NewsCard key={item.id} item={item} onChanged={reload} />)}</div>}</>}
      {tab === 'Rekomendasi' && <HubModules key="recommendations" kind="recommendations"/>}
      {tab === 'X Trending' && <HubModules key="x" kind="x"/>}
      {tab === 'YouTube Music' && <HubModules key="youtube" kind="youtube"/>}
      {tab === 'Sync Logs' && <HubModules key="logs" kind="logs"/>}
      {tab === 'API Integration' && <HubModules key="integration" kind="integration"/>}
      {tab === 'Pengaturan AI' && <AiPanel settings={ai} onChanged={reload} />}
      {tab === 'Pengaturan' && <HubModules key="settings" kind="settings"/>}
      <footer>Portal Content Hub · Tidak ada data contoh · Preview bukan jaminan layanan 24/7</footer>
    </main></div>;
}

function NotReady({ title, children }: { title: string; children: React.ReactNode }) { return <div className="panel"><span className="badge warn">Belum terintegrasi</span><h2>{title}</h2><p>{children}</p></div>; }

/** Public, read-only shell available only on Preview when no Hub database is configured.
 * It deliberately uses only the public source manifest and calls no protected API. */
function StaticHubPreview({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Ringkasan');
  return <div className="hub-root"><aside><div className="brand"><b>P</b> Portal Hub</div><nav aria-label="Menu pratinjau Hub">{tabs.map(t => <button type="button" key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav><div className="sidebar-note">PRATINJAU STATIS<br />Tidak terhubung ke database</div></aside>
    <main className="workspace"><header><div><div className="eyebrow">Workspace / Pratinjau Statis</div><h1>{tab}</h1><div className="muted">Tampilan tanpa data operasional</div></div><button type="button" className="button secondary" onClick={onClose}>Kembali ke login</button></header>
      <div className="notice warning"><b>Pratinjau visual, bukan Hub operasional.</b> Database Hub belum dikonfigurasi. Login admin, berita lama, perubahan, sinkronisasi, AI dan publikasi tidak tersedia di mode ini. Data yang terlihat berasal dari berkas konfigurasi, bukan database.</div>
      {tab === 'Ringkasan' && <><div className="cards"><div className="card"><span className="muted">Sumber di berkas konfigurasi</span><strong>{sourceManifest.items.length}</strong></div><div className="card"><span className="muted">Aktif dalam konfigurasi awal</span><strong>{sourceManifest.items.filter(s => s.enabled).length}</strong></div><div className="card"><span className="muted">Berita di database</span><strong>—</strong></div><div className="card"><span className="muted">Revisi disetujui</span><strong>—</strong></div></div><div className="panel"><h2>Yang dapat diperiksa</h2><p>Anda dapat meninjau susunan menu dan 11 sumber resmi yang diminta. Backend Hub lama belum dipindahkan sepenuhnya; ini bukan pengganti fungsi Hub lokal.</p><button type="button" className="button secondary" onClick={() => setTab('RSS Manager')}>Lihat 11 sumber →</button></div></>}
      {tab === 'RSS Manager' && <div className="panel"><h2>Sumber pada berkas konfigurasi ({sourceManifest.items.length})</h2><p>Belum ada pemeriksaan bahwa sumber ini telah didaftarkan pada database Preview. Semua ditandai nonaktif dalam konfigurasi awal.</p><table><thead><tr><th>Sumber / URL</th><th>Jenis</th><th>Status</th></tr></thead><tbody>{sourceManifest.items.map(s => <tr key={s.id}><td><b>{s.name}</b><br /><span className="tiny muted">{s.jurisdiction}</span><br /><a className="source-url" href={safeExternal(s.requestedUrl)} target="_blank" rel="noopener noreferrer">{s.requestedUrl}</a></td><td>Situs pemerintah</td><td><span className="badge warn">Belum aktif</span></td></tr>)}</tbody></table><p className="tiny">Tautan situs pemerintah bukan RSS terverifikasi.</p></div>}
      {tab !== 'Ringkasan' && tab !== 'RSS Manager' && <div className="panel"><span className="badge warn">Belum terhubung</span><h2>{tab}</h2><p>Fungsi dan data untuk menu ini belum tersedia dalam pratinjau statis. Tidak ada contoh berita, tren atau data yang dibuat-buat.</p>{tab === 'YouTube Music' && <p>Playlist yang direncanakan: OLT0p76Cd7kYMmbBNlt_TvC4vzjFTMKMNjw.</p>}{tab === 'Pengaturan AI' && <p>Jangan masukkan API key ke pratinjau statis; pengaturan dan pemrosesan AI belum terhubung.</p>}</div>}
      <footer>Pratinjau statis · Tidak ada penyimpanan atau pengumpulan otomatis</footer>
    </main></div>;
}

function SourceForm({ onChanged }: { onChanged: () => Promise<void> }) {
  const [name, setName] = useState(''), [jurisdiction, setJurisdiction] = useState(''), [url, setUrl] = useState('');
  const [region, setRegion] = useState('NTB'), [kind, setKind] = useState('rss'), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await api('sources', { name: name.trim(), jurisdiction: jurisdiction.trim(), region, url: url.trim(), kind });
      setName(''); setJurisdiction(''); setUrl(''); setMessage('Sumber tersimpan nonaktif. Akses, format dan hak belum diuji.'); await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sumber gagal disimpan.'); }
    finally { setBusy(false); }
  }
  return <form className="form-grid" onSubmit={save}><p>Hanya mencatat sumber; tidak mengakses situs atau mengaktifkan pengumpulan. Pilihan RSS merupakan jenis yang diajukan, bukan bukti feed valid.</p>
    <label>Nama sumber<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Media atau wilayah sumber<input required maxLength={200} value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} /></label>
    <label>Wilayah<select value={region} onChange={e => setRegion(e.target.value)}>{['NTB','Bali','NTT','Nasional','Lainnya'].map(v => <option key={v}>{v}</option>)}</select></label>
    <label>Jenis yang diajukan<select value={kind} onChange={e => setKind(e.target.value)}><option value="rss">RSS</option><option value="government_website">Situs pemerintah (.go.id)</option></select></label>
    <label>URL HTTPS<input required type="url" maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} /></label>
    <div><button className="button" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan nonaktif'}</button></div>{message && <p role="status">{message}</p>}
  </form>;
}

function NewsCard({ item, onChanged }: { item: News; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(item.editorialTitle || ''); const [summary, setSummary] = useState(item.editorialSummary || ''); const [category, setCategory] = useState(item.editorialCategory || '');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(item.editorialTitle || ''); setSummary(item.editorialSummary || ''); setCategory(item.editorialCategory || ''); }, [item.editorialTitle, item.editorialSummary, item.editorialCategory, item.version]);
  async function edit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await api('news', { action: 'edit', id: item.id, version: item.version, editorialTitle: title.trim() || null, editorialSummary: summary.trim() || null, editorialCategory: category.trim() || null }); setMessage('Perubahan editorial tersimpan.'); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan.'); } finally { setBusy(false); }
  }
  async function suggest() {
    if(!window.confirm('Kirim hanya judul dan cuplikan publik berita NTB ke provider gratis? Tidak otomatis menyimpan atau menerbitkan.'))return;
    setBusy(true);setMessage('');
    try{const r=await api<{summary:string|null;provider:string}>('ai-suggest',{id:item.id,version:item.version});setMessage(r.summary?'Saran '+r.provider+': '+r.summary+' — salin ke editor bila disetujui.':'Provider gagal; teks asli dipertahankan.');}catch(e){setMessage(e instanceof Error?e.message:'AI belum siap.');}finally{setBusy(false);}
  }
  async function approve() {
    if (!window.confirm(`Setujui revisi ${item.version}? Tindakan ini belum menerbitkan berita.`)) return;
    setBusy(true); setMessage('');
    try { await api('news', { action: 'approve', id: item.id, version: item.version }); setMessage('Revisi disetujui; publikasi belum aktif.'); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyetujui.'); } finally { setBusy(false); }
  }
  return <article className="article"><div className="row"><span className={'badge ' + (item.reviewState === 'approved' ? 'ok' : 'warn')}>{item.reviewState}</span><span className="tiny muted">Revisi {item.version}</span></div><h3>{item.editorialTitle || item.sourceTitle}</h3><p className="tiny">{item.sourceName} · Terbit: {formatDate(item.sourcePublishedAt)}<br />Ditemukan: {formatDate(item.firstSeenAt)}</p>{item.sourceDateRaw && !item.sourcePublishedAt && <p className="tiny">Tanggal mentah dari sumber: {item.sourceDateRaw} (belum terverifikasi)</p>}
    {item.possibleDuplicates > 0 && <div className="notice warning">Kemungkinan URL sama dengan {item.possibleDuplicates} entri lain. Periksa atribusi; belum digabungkan.</div>}
    <p>{item.editorialSummary || item.sourceSnippet || 'Cuplikan belum tersedia.'}</p><a href={safeExternal(item.sourceUrl)} target="_blank" rel="noopener noreferrer">Buka sumber ↗</a>
    <details><summary>Edit editorial</summary><form className="form-grid" onSubmit={edit}><label>Judul editorial<input maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Ringkasan editorial<textarea maxLength={1500} value={summary} onChange={e => setSummary(e.target.value)} /></label><label>Kategori<input maxLength={100} value={category} onChange={e => setCategory(e.target.value)} /></label><button className="button secondary" disabled={busy}>Simpan revisi</button></form></details>
    <div className="form-actions"><button className="button secondary" type="button" disabled={busy} onClick={()=>void suggest()}>Saran AI · NTB</button><button className="button" type="button" onClick={() => void approve()} disabled={busy || item.reviewState === 'approved' || item.reviewState === 'identity_review' || !item.sourcePublishedAt}>Setujui revisi</button></div>{message && <p role="status" className="tiny">{message}</p>}
  </article>;
}

function AiPanel({ settings, onChanged }: { settings: Ai | null; onChanged: () => Promise<void> }) {
  const [provider, setProvider] = useState('openrouter'); const [model, setModel] = useState(''); const [key, setKey] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { setModel(settings?.providers.find(p => p.provider === provider)?.model || ''); setKey(''); }, [provider, settings]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await api('ai-settings', { provider, model: model.trim(), ...(key ? { apiKey: key } : {}) }); setKey(''); setMessage('Pengaturan tersimpan. API key baru, jika ada, disimpan terenkripsi. Gunakan Saran AI di kartu berita; perubahan tidak otomatis diterapkan.'); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan.'); } finally { setBusy(false); }
  }
  const current = settings?.providers.find(p => p.provider === provider);
  return <><OperationalSetup settings={settings} onChanged={onChanged}/><div className="notice warning">AI manual menghasilkan saran kutipan ringkas, bukan artikel baru. Maksimum 20 percobaan provider per hari UTC. OpenRouter Free → Groq (jika akun gratis dikonfirmasi) → teks asli. Cohere dan Mistral tidak dipanggil oleh runtime ini.</div><div className="panel"><h2>Provider & model</h2><p>Rencana: OpenRouter gratis → Groq Free → teks asli/cache. Cohere hanya untuk evaluasi, bukan publikasi. Ketersediaan dan kuota harus diperiksa kembali sebelum penggunaan.</p><form className="form-grid" onSubmit={save}><label>Provider<select value={provider} onChange={e => setProvider(e.target.value)}><option value="openrouter">OpenRouter Free</option><option value="groq">Groq</option><option value="cohere">Cohere · evaluasi saja</option></select></label><label>Nama model<input required maxLength={150} value={model} onChange={e => setModel(e.target.value)} placeholder={provider === 'openrouter' ? 'nama-provider/nama-model:free' : 'ID model dari provider'} /></label><label>API key {current?.keyConfigured ? '(sudah tersimpan; kosongkan untuk mempertahankan)' : '(opsional sampai siap)' }<input type="password" autoComplete="off" maxLength={1000} value={key} onChange={e => setKey(e.target.value)} disabled={!settings?.masterKeyReady} /></label>{!settings?.masterKeyReady && <p className="tiny">Kunci enkripsi backend belum disiapkan. API key tidak dapat disimpan sampai kunci tersebut tersedia.</p>}<div><button className="button" disabled={busy || !settings}>{busy ? 'Menyimpan…' : 'Simpan pengaturan'}</button></div></form>{message && <p role="status">{message}</p>}<p className="tiny">Kunci penyedia tidak dikirim kembali ke browser setelah disimpan. Master key enkripsi harus disimpan dan dibackup secara terpisah dari database.</p></div></>;
}

function OperationalSetup({settings,onChanged}:{settings:Ai|null;onChanged:()=>Promise<void>}){
 const [allow,setAllow]=useState(false),[groq,setGroq]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setAllow(settings?.policy?.allowPublic||false);setGroq(settings?.policy?.groqFree||false);},[settings]);
 async function prepare(){if(!window.confirm('Siapkan indeks unik dan tabel kuota/cache di Preview webhub? Konflik data akan membatalkan transaksi; tidak menghapus data.'))return;setBusy(true);try{await api('maintenance',{confirm:'PREPARE PREVIEW'});setMessage('Skema siap.');await onChanged();}catch(e){setMessage(e instanceof Error?e.message:'Gagal');}finally{setBusy(false);}}
 async function consent(){setBusy(true);try{await api('ai-settings',{action:'policy',allowPublic:allow,groqFree:groq});setMessage('Izin tersimpan.');await onChanged();}catch(e){setMessage(e instanceof Error?e.message:'Gagal');}finally{setBusy(false);}}
 return <div className="panel"><h2>Kesiapan operasional</h2><p>Master backend: {settings?.masterKeyReady?'format tersedia':'belum tersedia'} · Kunci provider: {settings?.keysReadable?'dapat dibuka':'belum cocok / belum siap'}</p><button type="button" className="button secondary" disabled={busy} onClick={()=>void prepare()}>Siapkan skema Preview</button><p><label><input type="checkbox" checked={allow} onChange={e=>setAllow(e.target.checked)}/> Izinkan judul/cuplikannya yang publik dikirim; provider gratis dapat menyimpan atau melatih dari data tersebut.</label></p><p><label><input type="checkbox" checked={groq} onChange={e=>setGroq(e.target.checked)}/> Akun Groq adalah Free tanpa billing aktif.</label></p><button type="button" className="button" disabled={busy} onClick={()=>void consent()}>Simpan izin AI</button>{message&&<p role="status">{message}</p>}<p className="tiny">Kunci Mistral tetap aman di arsip, belum menjadi provider runtime. Jangan mengganti master backend yang telah mengenkripsi data lain.</p></div>;
}
