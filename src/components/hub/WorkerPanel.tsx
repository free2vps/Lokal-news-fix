'use client';
import React,{useCallback,useEffect,useState} from 'react';

const KIND:Record<string,string>={profiles_batch:'Profil konten (25 berita)',value_batch:'Nilai editorial (25 berita)',summary_batch:'Ringkasan AI (maks 5, kuota harian)'};

async function call(query='',body?:Record<string,unknown>){
 const r=await fetch('/api/hub/worker'+ (body?'':query),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{'X-Hub-Request':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Pekerja belum siap.');return j;
}
const at=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?new Intl.DateTimeFormat('id-ID',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Makassar'}).format(new Date(v))+' WITA':typeof v==='string'&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('id-ID',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Makassar'}).format(new Date(v))+' WITA':'—';

export default function WorkerPanel(){
 const [s,setS]=useState<any>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[kind,setKind]=useState('value_batch'),[token,setToken]=useState(''),[label,setLabel]=useState('penjadwal eksternal');
 const load=useCallback(async()=>{try{setS(await call());}catch(e){setMsg(e instanceof Error?e.message:'Status pekerja belum dapat dibaca.');}},[]);
 useEffect(()=>{void load();},[load]);
 async function act(body:Record<string,unknown>,note?:string){setBusy(true);setMsg('');try{const r=await call('',body);if(note)setMsg(note);await load();return r;}catch(e){setMsg(e instanceof Error?e.message:'Gagal');await load();return null;}finally{setBusy(false);}}
 return <section className="panel"><h2>Tahap 7 · Pekerja tahan-putus</h2>
  <p>Antrean tersimpan di database dengan lease, percobaan ulang berjenjang, dan <i>dead letter</i>. Satu pekerja aktif pada satu waktu. Pekerja <b>tidak menerbitkan</b> dan tidak mengubah isi berita.</p>
  {!s?.ready&&<p className="tiny">Tabel pekerja belum disiapkan. Tidak ada yang berjalan sebelum Anda menekan tombol persiapan.</p>}
  <div className="form-actions">
   {!s?.ready&&<button className="button" disabled={busy} onClick={()=>{if(window.confirm('Siapkan tabel antrean pekerja? Tidak menghapus data dan tidak mengaktifkan penjadwal.'))void act({action:'prepare',confirm:'PREPARE WORKER'},'Tabel pekerja siap. Penjadwal otomatis tetap nonaktif.');}}>Siapkan tabel pekerja</button>}
   <button className="button" disabled={busy||!s?.ready} onClick={()=>{if(window.confirm('Jalankan satu tick pekerja? Hanya tugas yang sudah ada di antrean yang diproses.'))void act({action:'tick',confirm:'RUN WORKER',maxTasks:1},'Tick selesai. Lihat hasil pada log di bawah.');}}>{busy?'Memproses…':'Jalankan tick'}</button>
   <button className="button secondary" disabled={busy} onClick={()=>void load()}>Muat ulang</button>
  </div>
  {s?.ready&&<>
   <p><b>Antrean:</b> {s.queued} menunggu · {s.dead} dead letter. Runner: {s.runner?.active?`aktif (${s.runner.owner})`:'tidak aktif'}. {s.next&&<>Berikutnya: {KIND[s.next.kind]||s.next.kind} pada {at(s.next.nextRunAt)}{s.next.lastError?` · galat terakhir ${s.next.lastError}`:''}.</>}</p>
   <div className="form-actions"><select value={kind} onChange={e=>setKind(e.target.value)}>{Object.keys(KIND).map(k=><option key={k} value={k}>{KIND[k]}</option>)}</select>
    <button className="button secondary" disabled={busy} onClick={()=>{if(window.confirm('Tambahkan tugas ini ke antrean? Tugas ringkasan tetap tunduk pada kuota AI harian.'))void act({action:'enqueue',confirm:'ENQUEUE WORKER',kind},'Tugas ditambahkan ke antrean.');}}>Tambah tugas</button>
    <button className="button secondary" disabled={busy} onClick={()=>{if(window.confirm('Kembalikan tugas yang lease-nya kedaluwarsa ke antrean?'))void act({action:'recover',confirm:'RECOVER WORKER'},'Tugas kedaluwarsa dipulihkan.');}}>Pulihkan lease kedaluwarsa</button></div>
   <p className="tiny">Kuota AI hari ini: {s.aiQuota?`${s.aiQuota.attemptsToday} terpakai · ${s.aiQuota.remainingToday} sisa`:'belum tersedia'}. Penjadwal otomatis: <b>nonaktif</b> (cron Production tidak diubah). Picu manual atau gunakan penjadwal eksternal dengan token di bawah.</p>
   <details><summary>Token untuk penjadwal eksternal</summary><p className="tiny">Token hanya ditampilkan sekali, disimpan sebagai hash, dapat dicabut. Penjadwal cukup memanggil <code>POST /api/hub/worker?action=tick</code> dengan header <code>Authorization: Bearer …</code>. Jangan simpan token di frontend/GitHub.</p>
    <div className="form-actions"><input maxLength={60} value={label} onChange={e=>setLabel(e.target.value)} aria-label="Label token"/><button className="button secondary" disabled={busy} onClick={async()=>{if(!window.confirm('Buat token pekerja baru? Simpan hasilnya sekarang; tidak ditampilkan lagi.'))return;const r=await act({action:'issueToken',confirm:'ISSUE WORKER TOKEN',label});if(r?.token)setToken(r.token);}}>Buat token</button></div>
    {token&&<p role="status"><b>Token (salin sekarang):</b> <code>{token}</code></p>}
    {s.tokens?.length>0&&<ul>{s.tokens.map((t:any)=><li key={t.id}>{t.label} · dibuat {at(t.createdAt)} · {t.revoked?'dicabut':`terakhir dipakai ${at(t.lastUsedAt)}`} {!t.revoked&&<button className="button secondary" disabled={busy} onClick={()=>{if(window.confirm('Cabut token ini?'))void act({action:'revokeToken',confirm:'REVOKE WORKER TOKEN',id:t.id},'Token dicabut.');}}>Cabut</button>}</li>)}</ul>}
   </details>
   {s.deadLetters?.length>0&&<><h3>Dead letter</h3><ul>{s.deadLetters.map((d:any)=><li key={d.id}>{KIND[d.kind]||d.kind} · {d.attempts} percobaan · {d.error} · {at(d.at)}</li>)}</ul></>}
   <h3>Log pekerja terakhir</h3><table><thead><tr><th>Jenis</th><th>Status</th><th>Pesan</th><th>Waktu</th></tr></thead><tbody>{s.logs?.map((l:any,i:number)=><tr key={i}><td>{KIND[l.kind]||l.kind}</td><td>{l.status}</td><td>{l.message}</td><td>{at(l.at)}</td></tr>)}</tbody></table>
   <p className="tiny">Keterbatasan: tick dipicu manual/eksternal, bukan jadwal otomatis di dalam hosting. Tugas berjalan bergiliran; bila tab/hosting berhenti di tengah, lease akan dipulihkan pada tick berikutnya. Tidak ada publikasi otomatis dan tidak ada AI per pengunjung.</p>
  </>}
  {msg&&<p role="status">{msg}</p>}</section>;
}
