'use client';
import React,{useCallback,useEffect,useState} from 'react';

const STEP_LABEL:Record<string,string>={rss:'Ambil RSS',profiles:'Profil konten',values:'Nilai editorial',summaries:'Ringkasan AI',social_queue:'Antrean media sosial',publish:'Terbit terjadwal'};
async function call(path:string,body?:Record<string,unknown>){
 const r=await fetch(path,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{'X-Hub-Request':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Permintaan gagal');return j;
}
const auto=(body?:Record<string,unknown>)=>call('/api/hub/automation',body);
const social=(body?:Record<string,unknown>)=>call('/api/hub/social',body);
const pub=(body?:Record<string,unknown>)=>call('/api/hub/publish',body);
const at=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('id-ID',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Makassar'}).format(new Date(v))+' WITA':'—';

export default function AutomationPanel(){
 const [a,setA]=useState<any>(null),[s,setS]=useState<any>(null),[p,setP]=useState<any>(null);
 const [msg,setMsg]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
 const [autoLabel,setAutoLabel]=useState('penjadwal 3 jam'),[autoToken,setAutoToken]=useState('');
 const [socialLabel,setSocialLabel]=useState('make.com'),[socialToken,setSocialToken]=useState('');

 const load=useCallback(async()=>{
  try{
   const [au,so,pu]=await Promise.all([auto(),social(),call('/api/hub/publish')]);
   setA(au);setS(so);setP(pu.status);
   setErr('');
  }catch(e){setErr(e instanceof Error?e.message:'Status belum dapat dibaca.');}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function act(fn:()=>Promise<any>,note?:string){setBusy(true);setErr('');setMsg('');try{const r=await fn();if(note)setMsg(note);await load();return r;}catch(e){setErr(e instanceof Error?e.message:'Gagal');await load();return null;}finally{setBusy(false);}}

 const ready=a?.ready===true;
 const scheduleOn=p?.config?.scheduleEnabled===true;
 return <section className="panel"><h2>Tahap 9 · Otomasi 3 jam & Facebook (pull)</h2>
  <p>Pipeline otomatis tiap <b>3 jam</b>: ambil RSS → profil konten → nilai editorial → ringkasan hemat token → antrean media sosial → (opsional) terbitkan artikel yang <b>sudah disetujui</b>. Make.com menarik <b>maksimal 4 berita</b> per putaran lalu memposting ke Halaman Facebook.</p>
  <p className="tiny">Persetujuan berita <b>tetap manual</b>. Otomasi tidak pernah menyetujui tulisan sendiri, dan Hub tidak menyimpan token Facebook. Penjadwal memakai Make/GitHub Actions/cron-job.org karena cron Vercel Hobby hanya 1×/hari.</p>

  {!ready&&<div className="form-actions"><button className="button" disabled={busy} onClick={()=>{if(window.confirm('Siapkan tabel otomasi & antrean media sosial? Tidak mengaktifkan jadwal dan tidak mengirim apa pun.'))void act(()=>auto({action:'prepare',confirm:'PREPARE AUTOMATION'}),'Tabel siap. Jadwal masih nonaktif.');}}>Siapkan tabel otomasi</button></div>}

  {ready&&<>
   <h3>1. Jadwal & eksekusi</h3>
   <p><b>Terbit terjadwal:</b> {scheduleOn?'AKTIF (maks 4 artikel/putaran)':'nonaktif'}. <b>Putaran terakhir:</b> {a?.last?`${at(a.last.at)} · ${a.last.status}`:'belum pernah'}.</p>
   <div className="form-actions">
    <button className="button" disabled={busy} onClick={()=>{if(window.confirm('Jalankan pipeline sekarang (satu putaran)? Langkah yang sama dengan jadwal 3 jam.'))void act(()=>auto({action:'run',confirm:'RUN AUTOMATION'}),'Pipeline selesai. Lihat ringkasan di bawah.');}}>{busy?'Menjalankan…':'Jalankan satu putaran sekarang'}</button>
    <button className="button secondary" disabled={busy||!p?.ready} onClick={()=>{if(!scheduleOn){if(!window.confirm('Aktifkan terbit terjadwal? Artikel yang SUDAH disetujui akan dikirim ke situs otomatis tiap putaran (maks 4). Persetujuan tetap manual.'))return;void act(()=>pub({action:'setSchedule',confirm:'ENABLE SCHEDULE 3H',enable:true}),'Terbit terjadwal aktif.');}else{if(!window.confirm('Matikan terbit terjadwal?'))return;void act(()=>pub({action:'setSchedule',confirm:'x',enable:false}),'Terbit terjadwal dimatikan.');}}}>{scheduleOn?'Matikan terbit terjadwal':'Aktifkan terbit terjadwal'}</button>
    <button className="button secondary" disabled={busy} onClick={()=>void load()}>Muat ulang</button>
   </div>
   {a?.runs?.length>0&&<table><thead><tr><th>Waktu</th><th>Pemicu</th><th>Status</th><th>Langkah</th><th>Durasi</th></tr></thead><tbody>{a.runs.map((r:any,i:number)=><tr key={i}><td>{at(r.at)}</td><td>{r.trigger}</td><td>{r.status}</td><td className="tiny">{r.steps.map((x:any)=>`${STEP_LABEL[x.step]||x.step}: ${x.ok?'✓':'✗'} ${x.detail}`).join(' · ')}</td><td>{r.durationMs} ms</td></tr>)}</tbody></table>}

   <h3>2. Token penjadwal 3 jam</h3>
   <p className="tiny">Dipakai skeduler untuk memanggil <code>POST /api/hub/automation?action=run</code> setiap 3 jam. Token hanya ditampilkan sekali dan disimpan sebagai hash.</p>
   <div className="form-actions"><input maxLength={60} value={autoLabel} onChange={e=>setAutoLabel(e.target.value)} aria-label="Label token otomasi"/><button className="button secondary" disabled={busy} onClick={async()=>{if(!window.confirm('Buat token otomasi baru? Simpan sekarang; tidak ditampilkan lagi.'))return;const r=await act(()=>auto({action:'issueToken',confirm:'ISSUE AUTOMATION TOKEN',label:autoLabel}));if(r?.token)setAutoToken(r.token);}}>Buat token otomasi</button></div>
   {autoToken&&<p role="status"><b>Token otomasi (salin sekarang):</b> <code>{autoToken}</code></p>}
   {a?.tokens?.length>0&&<ul>{a.tokens.map((t:any)=><li key={t.id}>{t.label} · dibuat {at(t.createdAt)} · {t.revoked?'dicabut':`terakhir dipakai ${at(t.lastUsedAt)}`} {!t.revoked&&<button className="button secondary" disabled={busy} onClick={()=>{if(window.confirm('Cabut token otomasi ini?'))void act(()=>auto({action:'revokeToken',confirm:'REVOKE AUTOMATION TOKEN',id:t.id}),'Token otomasi dicabut.');}}>Cabut</button>}</li>)}</ul>}

   <h3>3. Antrean media sosial (Make menarik)</h3>
   <p><b>Antrean:</b> menunggu {s?.pending||0} · terkirim {s?.delivered||0} · gagal {s?.failed||0}. Batas per tarikan: <b>{s?.facebookMaxPerRun||4}</b>. Tautan artikel ke situs: {s?.siteUrlConfigured?'aktif (HUB_PUBLIC_SITE_URL)':'belum diset—tautan memakai URL sumber'}.</p>
   <div className="form-actions">
    <button className="button secondary" disabled={busy||!s?.ready} onClick={()=>{if(window.confirm('Isi antrean dari artikel yang sudah terbit di situs?'))void act(()=>social({action:'enqueue',confirm:'ENQUEUE SOCIAL'}),'Antrean diperbarui.');}}>Isi antrean dari artikel terbit</button>
    <button className="button secondary" disabled={busy||!s?.ready} onClick={()=>{if(!window.confirm('Pratinjau tarikan? Item akan dikembalikan ke antrean (status failed) untuk dicoba ulang.'))return;void act(async()=>{const r=await social({action:'previewPull',confirm:'PREVIEW PULL'});setMsg(`Pratinjau: ${r.count} item siap dikirim.`);return r;});}}>Pratinjau tarikan (tanpa kirim)</button>
    <button className="button secondary" disabled={busy||!s?.ready} onClick={()=>{if(window.confirm('Kembalikan item gagal ke antrean?'))void act(()=>social({action:'requeue',confirm:'REQUEUE SOCIAL'}),'Item gagal dikembalikan.');}}>Ulangi item gagal</button>
   </div>
   <div className="form-actions"><input maxLength={60} value={socialLabel} onChange={e=>setSocialLabel(e.target.value)} aria-label="Label token sosial"/><button className="button secondary" disabled={busy} onClick={async()=>{if(!window.confirm('Buat token Make baru? Simpan sekarang; tidak ditampilkan lagi.'))return;const r=await act(()=>social({action:'issueToken',confirm:'ISSUE SOCIAL TOKEN',label:socialLabel}));if(r?.token)setSocialToken(r.token);}}>Buat token Make</button></div>
   {socialToken&&<p role="status"><b>Token Make (salin sekarang):</b> <code>{socialToken}</code></p>}
   {s?.tokens?.length>0&&<ul>{s.tokens.map((t:any)=><li key={t.id}>{t.label} · {t.scopes} · dibuat {at(t.createdAt)} · {t.revoked?'dicabut':`terakhir dipakai ${at(t.lastUsedAt)}`} {!t.revoked&&<button className="button secondary" disabled={busy} onClick={()=>{if(window.confirm('Cabut token Make ini?'))void act(()=>social({action:'revokeToken',confirm:'REVOKE SOCIAL TOKEN',id:t.id}),'Token Make dicabut.');}}>Cabut</button>}</li>)}</ul>}
   {s?.runs?.length>0&&<table><thead><tr><th>Aksi</th><th>Diambil</th><th>Terkirim</th><th>Gagal</th><th>Oleh</th><th>Waktu</th></tr></thead><tbody>{s.runs.map((r:any,i:number)=><tr key={i}><td>{r.action}</td><td>{r.claimed}</td><td>{r.delivered}</td><td>{r.failed}</td><td>{r.actor}</td><td>{at(r.at)}</td></tr>)}</tbody></table>}

   <h3>4. Alur di Make.com</h3>
   <ol className="tiny">
    <li><b>Skenario A (tiap 3 jam):</b> Schedule → HTTP <code>POST {typeof window!=='undefined'?window.location.origin:'https://…'}/api/hub/automation?action=run</code> dengan header <code>Authorization: Bearer &lt;token otomasi&gt;</code>.</li>
    <li><b>Skenario B (tiap 3 jam):</b> HTTP <code>POST …/api/hub/social?action=pull</code> (token Make) → Iterator → Facebook Pages “Create a Post” (pesan = judul + ringkasan + tautan) → HTTP <code>POST …/api/hub/social?action=ack</code> dengan <code>{'results:[{"deliveryKey":"…","ok":true}]'}</code>.</li>
    <li>Kuota gratis Make 1.000 operasi/bulan dan 2 skenario aktif: jadwal 3 jam = 8 putaran/hari. Perkirakan ±4 operasi/putaran untuk skenario B (≈960/bulan) — sudah mendekati batas bila ada pengulangan.</li>
   </ol>
  </>}
  <p className="tiny">Batas pengiriman media sosial: <i>at-least-once</i>—jika ack gagal padahal posting sukses, item dapat muncul lagi setelah lease 6 jam; Hub tidak memverifikasi hasil posting ke Facebook.</p>
  {err&&<p role="alert" className="notice error">{err}</p>}{msg&&<p role="status">{msg}</p>}</section>;
}
