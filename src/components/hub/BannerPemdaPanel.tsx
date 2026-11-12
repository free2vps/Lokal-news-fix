'use client';
import React,{useCallback,useEffect,useState,type FormEvent} from 'react';

type Baris={id:number;judul:string;gambar_url:string;tautan:string|null;aktif:boolean;mulai:string|null;selesai:string|null;urutan:number};
const kosong={id:0,judul:'',gambar_url:'',tautan:'',mulai:'',selesai:'',urutan:0,aktif:true};

async function kirim(body:Record<string,unknown>){
  const r=await fetch('/api/hub/banner',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','X-Hub-Request':'1'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(j.error||'Permintaan ditolak server.');
  return j;
}

/**
 * Panel pemilik untuk slot "Pengumuman" di beranda.
 *
 * Gambar dimasukkan sebagai ALAMAT (https), bukan diunggah: berkas tetap di server pemda
 * dan tidak memakan ruang/kuota portal. Kolom bertanda * wajib; portal tidak mengarang isi.
 */
export default function BannerPemdaPanel(){
  const [rows,setRows]=useState<Baris[]>([]),[form,setForm]=useState<any>({...kosong});
  const [pesan,setPesan]=useState(''),[galat,setGalat]=useState(''),[busy,setBusy]=useState(false),[siap,setSiap]=useState(true);

  const muat=useCallback(async()=>{
    try{
      const r=await fetch('/api/hub/banner',{credentials:'same-origin',cache:'no-store'});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(j.error||'Belum dapat dibaca.');
      setRows(Array.isArray(j.items)?j.items:[]);setGalat('');setSiap(true);
    }catch(e){setSiap(false);setGalat(e instanceof Error?e.message:'Gagal memuat banner');}
  },[]);
  useEffect(()=>{void muat();},[muat]);

  async function simpan(e:FormEvent){
    e.preventDefault();setBusy(true);setPesan('');setGalat('');
    try{
      await kirim(form);setForm({...kosong});setPesan('Banner disimpan. Beranda diperbarui dalam ±5 menit.');await muat();
    }catch(err){setGalat(err instanceof Error?err.message:'Gagal menyimpan');}finally{setBusy(false);}
  }
  async function hapus(id:number){
    if(!window.confirm('Hapus banner ini? Tindakan ini permanen.'))return;
    setBusy(true);try{await kirim({action:'delete',id});setPesan('Banner dihapus.');await muat();}
    catch(err){setGalat(err instanceof Error?err.message:'Gagal menghapus');}finally{setBusy(false);}
  }

  return <section className="panel" aria-label="Banner pengumuman pemda">
    <h2>Banner / pengumuman pemda</h2>
    <p className="tiny">Satu slot tetap di beranda, selalu berlabel <b>Pengumuman</b>. Isi bergilir mengikuti urutan nomor (kecil lebih dulu). Gambar diisi sebagai alamat https — berkas tidak diunggah ke portal, jadi tidak menambah kuota.</p>
    {!siap&&<p role="alert">{galat} Jalankan berkas <code>supabase/migrations/20261112_banner_pemda.sql</code> di Supabase bila tabelnya belum ada.</p>}
    <form className="form-grid" onSubmit={simpan}>
      <label>Judul tampilan *<input required maxLength={160} value={form.judul} onChange={e=>setForm({...form,judul:e.target.value})}/></label>
      <label>Alamat gambar (https) *<input required type="url" placeholder="https://…" value={form.gambar_url} onChange={e=>setForm({...form,gambar_url:e.target.value})}/></label>
      <label>Alamat tujuan (boleh kosong)<input type="url" placeholder="https://…" value={form.tautan??''} onChange={e=>setForm({...form,tautan:e.target.value})}/></label>
      <label>Mulai tayang (boleh kosong)<input type="date" value={form.mulai??''} onChange={e=>setForm({...form,mulai:e.target.value})}/></label>
      <label>Selesai tayang (boleh kosong)<input type="date" value={form.selesai??''} onChange={e=>setForm({...form,selesai:e.target.value})}/></label>
      <label>Urutan<input type="number" min={0} max={99} value={form.urutan} onChange={e=>setForm({...form,urutan:Number(e.target.value)})}/></label>
      <label><input type="checkbox" checked={form.aktif} onChange={e=>setForm({...form,aktif:e.target.checked})}/>Tayangkan sekarang</label>
      <div className="form-actions">
        <button className="button" disabled={busy}>{form.id?'Simpan perubahan':'Tambah banner'}</button>
        {form.id>0&&<button type="button" className="button secondary" disabled={busy} onClick={()=>setForm({...kosong})}>Batal ubah</button>}
      </div>
    </form>
    {pesan&&<p role="status">{pesan}</p>}
    {galat&&siap&&<p role="alert">{galat}</p>}
    {rows.length>0
      ? <table><thead><tr><th>Judul</th><th>Gambar</th><th>Tayang</th><th>Urutan</th><th/></tr></thead><tbody>
          {rows.map(r=><tr key={r.id}>
            <td>{r.judul}</td>
            <td className="tiny">{r.gambar_url.slice(0,48)}…</td>
            <td className="tiny">{r.aktif?'aktif':'nonaktif'}{r.mulai?` · mulai ${r.mulai}`:''}{r.selesai?` · selesai ${r.selesai}`:''}</td>
            <td>{r.urutan}</td>
            <td><button type="button" className="button secondary" disabled={busy} onClick={()=>setForm({...r,mulai:r.mulai??'',selesai:r.selesai??'',tautan:r.tautan??''})}>Ubah</button>{' '}
              <button type="button" className="button secondary" disabled={busy} onClick={()=>void hapus(r.id)}>Hapus</button></td>
          </tr>)}
        </tbody></table>
      : <p className="tiny">Belum ada banner. Selama kosong, tidak ada kotak kosong yang tampil di beranda.</p>}
  </section>;
}
