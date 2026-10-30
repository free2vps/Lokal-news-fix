'use client';
import React,{useCallback,useEffect,useState} from 'react';

const REASON:Record<string,string>={
  approval_version_mismatch:'persetujuan bukan untuk versi terbaru',
  already_in_outbox:'sudah ada di antrean terbit',
  rights_not_permission_confirmed:'hak sumber belum permission_confirmed',
  date_outside_window:'tanggal di luar rentang',
  risk_needs_review:'sinyal risiko menunggu tinjauan',
  value_tier_below_minimum:'kelas nilai di bawah minimum',
  value_stale:'nilai editorial perlu dihitung ulang',
  editorial_text_missing:'judul/ringkasan editorial belum lengkap',
  region_not_allowlisted:'wilayah di luar allowlist',
  source_not_allowlisted:'sumber di luar allowlist',
  category_not_allowlisted:'kategori di luar allowlist',
  not_approved:'belum disetujui',
};
async function call(body?:Record<string,unknown>){
 const r=await fetch('/api/hub/publish',{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{'X-Hub-Request':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Autopublish belum siap.');return j;
}
const at=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?new Intl.DateTimeFormat('id-ID',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Makassar'}).format(new Date(v))+' WITA':typeof v==='string'&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('id-ID',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Makassar'}).format(new Date(v))+' WITA':'—';

export default function AutopublishPanel(){
 const [data,setData]=useState<any>(null),[msg,setMsg]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[typed,setTyped]=useState('');
 const [sources,setSources]=useState<string[]>([]),[regions,setRegions]=useState<string[]>(['Bali','NTB','NTT']),[categories,setCategories]=useState(''),[tier,setTier]=useState('curated'),[dailyMax,setDailyMax]=useState(5),[windowHours,setWindowHours]=useState(72);
 const load=useCallback(async()=>{try{const d=await call();setData(d);const c=d.status.config;if(c){setSources(c.allowSourceIds||[]);setRegions(c.allowRegions||[]);setCategories((c.allowCategories||[]).join(', '));setTier(c.minValueTier);setDailyMax(c.dailyMax);setWindowHours(c.windowHours);}setErr('');}catch(e){setErr(e instanceof Error?e.message:'Status belum dapat dibaca.');}},[]);
 useEffect(()=>{void load();},[load]);
 async function act(body:Record<string,unknown>,note?:string){setBusy(true);setErr('');setMsg('');try{const r=await call(body);if(note)setMsg(note);await load();return r;}catch(e){setErr(e instanceof Error?e.message:'Gagal');await load();return null;}finally{setBusy(false);}}
 const s=data?.status,plan=data?.plan;
 return <section className="panel"><h2>Tahap 8 · Autopublish ber-allowlist (dry-run wajib)</h2>
  <p><b>Status:</b> {s?.publicationEnabled?'AKTIF SEMENTARA (izin sekali pakai)':'nonaktif · mode dry-run'}. Pengiriman ke situs {s?.targetConfigured?'terkonfigurasi di backend':'belum terkonfigurasi — tidak ada data yang dikirim'}. Penjadwal otomatis: nonaktif.</p>
  <p className="tiny">Autopublish hanya untuk berita yang <b>sudah disetujui manusia versi terbaru</b>, hak sumber <code>permission_confirmed</code>, wilayah &amp; sumber di allowlist, kelas nilai minimal, tanpa sinyal risiko. Patch ini <b>tidak mengubah beranda/layout</b> dan tidak menyalakan cron Production.</p>
  {!s?.ready&&<div className="form-actions"><button className="button" disabled={busy} onClick={()=>{if(window.confirm('Siapkan tabel autopublish? Tidak mengaktifkan apa pun dan tidak mengirim data.'))void act({action:'prepare',confirm:'PREPARE AUTOPUBLISH'},'Tabel siap; autopublish tetap nonaktif.');}}>Siapkan tabel autopublish</button></div>}
  {s?.ready&&<>
   <h3>Konfigurasi allowlist</h3>
   <p className="tiny">Setiap perubahan konfigurasi otomatis melucuti izin (kembali ke dry-run). Sumber yang dapat dipilih hanya sumber berstatus hak <code>permission_confirmed</code> ({data?.sources?.length||0} sumber).</p>
   <div className="form-grid">
    <label>Wilayah<select multiple value={regions} onChange={e=>setRegions([...e.target.selectedOptions].map(o=>o.value))}>{['Bali','NTB','NTT'].map(r=><option key={r} value={r}>{r}</option>)}</select></label>
    <label>Sumber diizinkan<select multiple value={sources} onChange={e=>setSources([...e.target.selectedOptions].map(o=>o.value))}>{(data?.sources||[]).map((x:any)=><option key={x.id} value={x.id}>{x.name} · {x.region}</option>)}</select></label>
    <label>Kategori (pisahkan koma, kosong = semua)<input value={categories} onChange={e=>setCategories(e.target.value)} maxLength={200}/></label>
    <label>Kelas nilai minimum<select value={tier} onChange={e=>setTier(e.target.value)}><option value="radar">Radar</option><option value="curated">Kurasi</option><option value="evidence_backed">Berbukti</option></select></label>
    <label>Maksimum per hari<input type="number" min={1} max={20} value={dailyMax} onChange={e=>setDailyMax(Number(e.target.value))}/></label>
    <label>Rentang umur berita (jam)<input type="number" min={1} max={168} value={windowHours} onChange={e=>setWindowHours(Number(e.target.value))}/></label>
   </div>
   <div className="form-actions"><button className="button secondary" disabled={busy} onClick={()=>{if(window.confirm('Simpan allowlist? Izin autopublish akan dilucuti.'))void act({action:'updateConfig',confirm:'UPDATE PUBLISH CONFIG',allowRegions:regions,allowSourceIds:sources,allowCategories:categories.split(',').map(x=>x.trim()).filter(Boolean),minValueTier:tier,dailyMax,windowHours},'Konfigurasi disimpan; autopublish dilucuti.');}}>Simpan konfigurasi</button>
    <button className="button secondary" disabled={busy} onClick={()=>void act({action:'dryRun',confirm:'DRY RUN PUBLISH'},'Dry-run selesai. Tidak ada data yang dikirim.')}>Dry-run (uji tanpa kirim)</button>
    <button className="button secondary" disabled={busy||!s.publicationEnabled} onClick={()=>{if(window.confirm('Cabut izin autopublish sekarang?'))void act({action:'disarm',confirm:'DISARM AUTOPUBLISH'},'Izin dicabut.');}}>Cabut izin</button></div>

   {plan&&<><h3>Rencana dry-run</h3>
    <p><b>{plan.eligible}</b> kandidat lolos · <b>{plan.excluded}</b> disaring · hash <code>{plan.planHash.slice(0,16)}…</code> · kelas min {plan.gates.minValueTier} · terkirim hari ini {plan.gates.sentToday}/{plan.gates.dailyMax}</p>
    {Object.keys(plan.reasons||{}).length>0&&<p className="tiny">Alasan disaring: {Object.entries(plan.reasons).map(([k,v])=>`${REASON[k]||k} (${v})`).join(' · ')}</p>}
    {plan.items?.length>0?<ul>{plan.items.map((i:any)=><li key={i.id}>{i.title} · {i.sourceName} · {i.regions.join(', ')} · {i.tier}</li>)}</ul>:<p>Belum ada kandidat yang lolos seluruh syarat.</p>}
    {plan.armBlockers?.length>0&&<p className="tiny">Belum bisa diaktifkan: {plan.armBlockers.join(' ')}</p>}
    <div className="notice"><p className="tiny"><b>Mengaktifkan hanya untuk rencana di atas:</b> izin berlaku 15 menit dan hangus setelah satu kali jalan. Ketik <code>AKTIFKAN</code> lalu tekan tombol. Ini adalah izin untuk mengirim artikel ke situs (Supabase) — pastikan Anda memang mengizinkannya sekarang.</p>
     <div className="form-actions"><input value={typed} onChange={e=>setTyped(e.target.value)} maxLength={20} aria-label="Ketik AKTIFKAN"/><button className="button" disabled={busy||typed!=='AKTIFKAN'||!plan.canArm} onClick={()=>{void act({action:'arm',confirm:'ARM AUTOPUBLISH',planHash:plan.planHash},'Izin aktif 15 menit untuk rencana ini.');setTyped('');}}>Aktifkan sesuai dry-run</button>
      <button className="button" disabled={busy||!s.publicationEnabled} onClick={()=>{if(!window.confirm('Kirim sekarang? Artikel yang lolos akan dikirim ke situs, lalu izin otomatis dicabut.'))return;void act({action:'publish',confirm:'PUBLISH NOW'},'Publikasi selesai. Izin otomatis dicabut.');}}>Kirim sekarang (sekali)</button></div></div></>}

   <h3>Audit</h3>
   <p className="tiny">Outbox: {Object.entries(s.outbox||{}).map(([k,v])=>`${k} ${v}`).join(' · ')||'kosong'}.</p>
   {s.runs?.length>0?<table><thead><tr><th>Mode</th><th>Hash</th><th>Lolos</th><th>Disaring</th><th>Waktu</th></tr></thead><tbody>{s.runs.map((r:any,i:number)=><tr key={i}><td>{r.mode}</td><td><code>{r.planHash}</code></td><td>{r.eligible}</td><td>{r.excluded}</td><td>{at(r.createdAt)}</td></tr>)}</tbody></table>:<p className="tiny">Belum ada riwayat dry-run.</p>}
   <p className="tiny">Batas: dry-run tidak menguji tulis ke situs; pengiriman pertama sebaiknya diawasi. Kelas nilai bukan verifikasi fakta, dan artikel tetap bisa salah. Tidak ada AI per pengunjung dan tidak ada perubahan layout.</p>
  </>}
  {err&&<p role="alert" className="notice error">{err}</p>}{msg&&<p role="status">{msg}</p>}</section>;
}
