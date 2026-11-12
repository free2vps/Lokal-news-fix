'use client';
import React,{useCallback,useEffect,useState,type FormEvent} from 'react';
import type {DrafPemda} from '@/lib/queries';

async function kirim(body:Record<string,unknown>){
  const r=await fetch('/api/hub/pemda-draft',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','X-Hub-Request':'1'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(j.error||'Permintaan ditolak server.');
  return j;
}

/**
 * Pintu tautan berita pemda.
 *
 * Alurnya sengaja dua langkah: tempel tautan → jadi DRAF; pemilik menekan Setujui untuk
 * menerbitkan. Tidak ada penerbitan otomatis, dan tidak ada parafrase AI — ringkasan
 * diambil dari kalimat asli sumber, lengkap dengan atribusi + tautan asli.
 */
export default function PemdaDraftPanel(){
  const [url,setUrl]=useState(''),[rows,setRows]=useState<DrafPemda[]>([]);
  const [pesan,setPesan]=useState(''),[galat,setGalat]=useState(''),[busy,setBusy]=useState(false),[catatan,setCatatan]=useState('');

  const muat=useCallback(async()=>{
    try{
      const r=await fetch('/api/hub/pemda-draft',{credentials:'same-origin',cache:'no-store'});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(j.error||'Belum dapat dibaca.');
      setRows(Array.isArray(j.items)?j.items:[]);setGalat('');
    }catch(e){setGalat(e instanceof Error?e.message:'Gagal memuat draf');}
  },[]);
  useEffect(()=>{void muat();},[muat]);

  async function sadur(e:FormEvent){
    e.preventDefault();setBusy(true);setPesan('');setGalat('');setCatatan('');
    try{
      const j=await kirim({action:'sadur',url});setCatatan(j.robots||'');setUrl('');
      setPesan('Draf dibuat. Periksa isinya, lalu tekan Setujui kalau layak terbit.');await muat();
    }catch(err){setGalat(err instanceof Error?err.message:'Gagal menyadur');}finally{setBusy(false);}
  }
  async function putuskan(id:number,aksi:'setuju'|'tolak'|'hapus'){
    if(aksi==='hapus'&&!window.confirm('Hapus catatan draf ini? Artikel yang sudah terbit tidak terhapus.'))return;
    if(aksi==='setuju'&&!window.confirm('Terbitkan draf ini sebagai berita di portal?'))return;
    setBusy(true);setGalat('');setPesan('');
    try{
      const j=await kirim({action:aksi,id});
      setPesan(aksi==='setuju'?`Diterbitkan: /berita/${j.slug}`:aksi==='tolak'?'Draf ditolak.':'Catatan draf dihapus.');
      await muat();
    }catch(err){setGalat(err instanceof Error?err.message:'Gagal memproses');}finally{setBusy(false);}
  }

  const draf=rows.filter(r=>r.status==='draf');
  return <section className="panel" aria-label="Tautan berita pemda">
    <h2>Tautan berita / pengumuman pemda</h2>
    <p className="tiny">Tempel tautan halaman pemda. Portal memeriksa <code>robots.txt</code> sumber lebih dulu; bila dilarang, permintaan dihentikan. Yang diambil hanya judul, tanggal, gambar, dan beberapa kalimat asli — bukan disalin utuh, bukan ditulis ulang AI. Hasilnya selalu <b>draf</b> yang harus Anda setujui.</p>
    <form className="form-grid" onSubmit={sadur}>
      <label>Alamat halaman pemda<input required type="url" placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/></label>
      <div className="form-actions"><button className="button" disabled={busy||!url}>Periksa & buat draf</button></div>
    </form>
    {catatan&&<p className="tiny">Pemeriksaan robots: {catatan}</p>}
    {pesan&&<p role="status">{pesan}</p>}
    {galat&&<p role="alert">{galat}</p>}

    <h3>Menunggu persetujuan ({draf.length})</h3>
    {draf.length===0&&<p className="tiny">Belum ada draf. Tautan pemda yang Anda tempel akan muncul di sini — tidak ada yang terbit tanpa persetujuan Anda.</p>}
    {draf.map(r=><article key={r.id} className="panel" style={{marginBlock:'0.75rem'}}>
      <h4>{r.judul}</h4>
      <p className="tiny">{r.sumber_nama} · {r.tanggal_sumber??'tanggal tidak tercantum'} · <a href={r.sumber_url} target="_blank" rel="noopener noreferrer">tautan asli</a></p>
      {r.gambar_url&&/* gambar hanya alamat asli, tidak diunggah ke portal */(
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.gambar_url} alt={r.judul} loading="lazy" style={{maxWidth:'100%',height:'auto',borderRadius:'8px'}}/>
      )}
      <p>{r.ringkasan}</p>
      <div className="form-actions">
        <button className="button" disabled={busy} onClick={()=>void putuskan(r.id,'setuju')}>Setujui & terbitkan</button>
        <button className="button secondary" disabled={busy} onClick={()=>void putuskan(r.id,'tolak')}>Tolak</button>
        <button className="button secondary" disabled={busy} onClick={()=>void putuskan(r.id,'hapus')}>Hapus</button>
      </div>
    </article>)}

    {rows.some(r=>r.status!=='draf')&&<details><summary>Sudah diputuskan ({rows.filter(r=>r.status!=='draf').length})</summary>
      <table><thead><tr><th>Judul</th><th>Status</th><th>Sumber</th><th/></tr></thead><tbody>
        {rows.filter(r=>r.status!=='draf').map(r=><tr key={r.id}>
          <td>{r.judul}</td><td>{r.status}</td><td className="tiny">{r.sumber_nama}</td>
          <td>{r.slug_artikel?<a href={`/berita/${r.slug_artikel}`}>lihat</a>:null}</td>
        </tr>)}
      </tbody></table>
    </details>}
  </section>;
}
