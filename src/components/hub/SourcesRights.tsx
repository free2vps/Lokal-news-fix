'use client';
import {useCallback,useEffect,useState} from 'react';

type Source={id:string;name:string;region:string;rightsStatus:string;active:boolean;itemCount:number;sourceKind:string};

async function post(body:Record<string,unknown>){
  const r=await fetch('/api/hub/sources',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-Hub-Request':'1'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({error:'Respons tidak terbaca'}));
  if(!r.ok)throw Error(j.error||'Gagal menyimpan');
  return j;
}

export default function SourcesRights(){
  const [rows,setRows]=useState<Source[]>([]);
  const [log,setLog]=useState<{sourceId:string;from:string|null;to:string;at:string}[]>([]);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');
  const [err,setErr]=useState('');

  const load=useCallback(async()=>{
    try{
      const r=await fetch('/api/hub/sources',{credentials:'same-origin',cache:'no-store'});
      const j=await r.json();
      if(!r.ok)throw Error(j.error||'Gagal memuat sumber');
      setRows((j.sources??[]) as Source[]);setLog(j.rightsLog??[]);
    }catch(e){setErr(e instanceof Error?e.message:'Gagal memuat sumber');}
  },[]);
  useEffect(()=>{void load();},[load]);

  async function mark(s:Source,status:'permission_confirmed'|'metadata_only'){
    const text=status==='permission_confirmed'
      ? `Tandai "${s.name}" sebagai PERMISSION CONFIRMED?\n\nHanya lanjutkan bila Anda sudah memastikan sumber ini mengizinkan pengambilan dan penerbitan.\n\nKetik: TANDAI HAK SUMBER`
      : `Turunkan "${s.name}" ke metadata_only (tidak diterbitkan otomatis)?`;
    if(!window.confirm(text))return;
    setBusy(true);setErr('');setNote('');
    try{await post({action:'rights',id:s.id,status,confirm:'TANDAI HAK SUMBER'});setNote(`${s.name} → ${status}`);await load();}
    catch(e){setErr(e instanceof Error?e.message:'Gagal');}
    finally{setBusy(false);}
  }

  const confirmed=rows.filter(r=>r.rightsStatus==='permission_confirmed').length;

  return <section aria-label="Hak sumber">
    <h2>Hak sumber <span className="tiny">(penentu redaktur otomatis)</span></h2>
    <p className="tiny">Redaktur otomatis hanya menerbitkan dari sumber berstatus <b>permission_confirmed</b>. Status ini adalah pernyataan Anda bahwa pengambilan dan penerbitan dari sumber itu sudah dipastikan boleh. Sistem tidak bisa memverifikasinya.</p>
    <p><b>{confirmed}</b> dari {rows.length} sumber berstatus permission_confirmed.</p>
    <div className="form-actions"><button className="button secondary" disabled={busy} onClick={()=>void load()}>Muat ulang</button></div>
    {!!rows.length&&<table>
      <thead><tr><th>Sumber</th><th>Wilayah</th><th>Hak</th><th>Aktif</th><th>Berita</th><th>Tindakan</th></tr></thead>
      <tbody>{rows.map(s=><tr key={s.id}>
        <td>{s.name}</td>
        <td>{s.region}</td>
        <td><b>{s.rightsStatus}</b></td>
        <td>{s.active?'ya':'tidak'}</td>
        <td>{s.itemCount}</td>
        <td>
          {s.rightsStatus!=='permission_confirmed'&&<button className="button" disabled={busy||!s.active} onClick={()=>void mark(s,'permission_confirmed')}>Tandai hak terkonfirmasi</button>}
          {s.rightsStatus==='permission_confirmed'&&<button className="button secondary" disabled={busy} onClick={()=>void mark(s,'metadata_only')}>Turunkan ke metadata_only</button>}
        </td>
      </tr>)}</tbody>
    </table>}
    {!rows.length&&<p className="tiny">Belum ada sumber terbaca.</p>}
    {!!log.length&&<details><summary>Riwayat perubahan hak ({log.length})</summary>
      <table><thead><tr><th>Sumber</th><th>Dari</th><th>Ke</th><th>Waktu</th></tr></thead>
        <tbody>{log.map((l,i)=><tr key={i}><td>{l.sourceId.slice(0,8)}…</td><td>{l.from||'—'}</td><td>{l.to}</td><td>{l.at}</td></tr>)}</tbody></table>
      <p className="tiny">Riwayat dicatat agar keputusan hak dapat ditelusuri. Mengubah hak tidak mengaktifkan redaktur otomatis; saklar tetap terpisah.</p>
    </details>}
    {note&&<p role="status">{note}</p>}
    {err&&<p role="alert" className="notice error">{err}</p>}
  </section>;
}
