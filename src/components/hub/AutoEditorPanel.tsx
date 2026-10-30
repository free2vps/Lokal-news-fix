'use client';
import {useCallback,useEffect,useState} from 'react';

type Step={step:string;ok:boolean;detail:string;count?:number;sources?:{id:string;name:string;ok:boolean;inserted:number;error?:string}[]};
type Run={trigger:string;status:string;pulled:number;selected:number;published:number;durationMs:number;at:string;steps:Step[]};
type Status={
  ready:boolean;
  config:{enabled:boolean;maxPerRun:number;maxPerDay:number;windowHours:number;minTier:string;regions:string[];rightsMode:string;aiPerRun:number;updatedAt:string|null};
  runs:Run[];sources:{total:number;permissionConfirmed:number;metadataOnly:number;unknown:number};publishedToday:number;
  policy:{maxPerRun:number;hardMaxPerRun:number;maxPerDay:number;windowHours:number;bulletsMax:number};
};

async function api(body:Record<string,unknown>,signal?:AbortSignal){
  const r=await fetch('/api/hub/auto-editor',{method:'POST',credentials:'same-origin',signal,
    headers:{'Content-Type':'application/json','X-Hub-Request':'1'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({error:'Respons tidak terbaca'}));
  if(!r.ok)throw Error(j.error||'Permintaan gagal');
  return j;
}

export default function AutoEditorPanel({initialStatus}:{initialStatus?:Status}){
  const [st,setSt]=useState<Status|null>(initialStatus??null);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');
  const [err,setErr]=useState('');
  const [adv,setAdv]=useState(false);
  const [cfg,setCfg]=useState<Status['config']|null>(initialStatus?.config??null);

  const load=useCallback(async()=>{
    try{const r=await fetch('/api/hub/auto-editor',{credentials:'same-origin',cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error);setSt(j);setCfg(j.config);}
    catch(e){setErr(e instanceof Error?e.message:'Gagal memuat status');}
  },[]);
  useEffect(()=>{void load();},[load]);

  async function act(fn:()=>Promise<unknown>,ok:string){
    setBusy(true);setErr('');setNote('');
    try{await fn();setNote(ok);await load();}
    catch(e){setErr(e instanceof Error?e.message:'Gagal');}
    finally{setBusy(false);}
  }

  const ready=st?.ready===true;
  const on=st?.config.enabled===true;
  const last=st?.runs?.[0];
  const noRights=(st?.sources.permissionConfirmed??0)===0;

  return <section aria-label="Redaktur otomatis" className="space-y-3">
    <h2>Redaktur Otomatis <span className="tiny">(Tahap 10)</span></h2>
    <p className="tiny">Rujukan: menu <b>RSS Manager</b> untuk mengaktifkan sumber &amp; menandai hak pakai. Di sini: satu alur tarik RSS → saring → ringkasan + poin penting → nilai → pilih → terbit. Ringkasan ekstraktif (gratis) untuk semua berita; AI hanya untuk prioritas Bali/NTB/NTT sesuai kuota.</p>

    <div className="notice" role="status">
      <p><b>Status: {on?'AKTIF — terbit otomatis':'NONAKTIF'}</b> · Terbit hari ini: {st?.publishedToday??0}/{st?.config.maxPerDay??0} · Maks/putaran: {st?.config.maxPerRun??0}</p>
      <p className="tiny">Kriteria: kelas ≥ {st?.config.minTier??'curated'} · umur ≤ {st?.config.windowHours??48} jam · wilayah {st?.config.regions?.join(', ')||'Bali, NTB, NTT'}</p>
    </div>

    {!ready&&<div className="form-actions"><button className="button" disabled={busy} onClick={()=>void act(()=>api({action:'prepare',confirm:'PREPARE AUTO EDITOR'}),'Tabel redaktur + tabel pendukung (profil, nilai, ringkasan, autopublish, antrean sosial) siap. Redaktur masih nonaktif.')}>Siapkan tabel redaktur otomatis</button></div>}

    {ready&&<>
      {noRights&&<p className="notice error" role="alert">Belum ada sumber berstatus <b>permission_confirmed</b> yang aktif ({st?.sources?.metadataOnly??0} sumber berstatus metadata_only). Dengan setelan bawaan, redaktur tidak akan menerbitkan apa pun. Tandai hak sumber lebih dulu — atau ubah ke mode headline di bagian Lanjutan (risiko hak cipta ditanggung pemilik).</p>}

      <div className="form-actions">
        <button className="button" disabled={busy} onClick={()=>void act(()=>api({action:'run',confirm:'RUN AUTO EDITOR'}),'Putaran selesai.')}>▶ Jalankan sekarang</button>
        <button className="button secondary" disabled={busy} onClick={()=>void act(()=>api({action:on?'disable':'enable',confirm:on?undefined:'AKTIFKAN REDAKTUR OTOMATIS'}),on?'Redaktur dimatikan.':'Redaktur diaktifkan.')}>{on?'Matikan redaktur':'Aktifkan redaktur otomatis'}</button>
        <button className="button secondary" disabled={busy} onClick={()=>void load()}>Muat ulang</button>
      </div>

      {last&&<div className="notice">
        <p><b>Putaran terakhir:</b> {last.status} · ditarik {last.pulled} · dipilih {last.selected} · terbit {last.published} · {Math.round(last.durationMs/1000)}s</p>
        <ol className="tiny">{last.steps.map((s,i)=><li key={i}>{s.ok?'✔':'✖'} {s.step}: {s.detail}
          {!!s.sources?.length&&<ul>{s.sources.map(x=><li key={x.id}>{x.ok?'•':'✖'} {x.name}: {x.ok?`${x.inserted} berita baru`:`gagal (${x.error})`}</li>)}</ul>}
        </li>)}</ol>
      </div>}

      {!!st?.runs?.length&&<table><thead><tr><th>Waktu</th><th>Pemicu</th><th>Status</th><th>Ditarik</th><th>Dipilih</th><th>Terbit</th></tr></thead>
        <tbody>{st.runs.map((r,i)=><tr key={i}><td>{r.at}</td><td>{r.trigger}</td><td>{r.status}</td><td>{r.pulled}</td><td>{r.selected}</td><td>{r.published}</td></tr>)}</tbody></table>}
    </>}

    <p className="tiny">Batas yang selalu berlaku: hanya sumber berhak jelas, tanpa menyalin fulltext/gambar sumber, atribusi + tautan asli dipertahankan, edit manual tidak pernah ditimpa, dan setiap putaran tercatat di audit. Mematikan redaktur langsung menghentikan penerbitan pada putaran berikutnya.</p>

    <details open={adv} onToggle={e=>setAdv((e.target as HTMLDetailsElement).open)}><summary>Lanjutan: konfigurasi &amp; pemicu Make</summary>
      <form className="form-grid" onSubmit={e=>{e.preventDefault();if(!cfg)return;void act(()=>api({action:'config',confirm:'SIMPAN KONFIGURASI EDITOR',config:cfg}),'Konfigurasi disimpan.');}}>
        <label>Maksimum terbit per putaran<input type="number" min={1} max={st?.policy.hardMaxPerRun??12} value={cfg?.maxPerRun??8} onChange={e=>setCfg(c=>c?{...c,maxPerRun:Number(e.target.value)}:c)}/></label>
        <label>Maksimum terbit per hari<input type="number" min={1} max={60} value={cfg?.maxPerDay??40} onChange={e=>setCfg(c=>c?{...c,maxPerDay:Number(e.target.value)}:c)}/></label>
        <label>Umur berita (jam)<input type="number" min={1} max={168} value={cfg?.windowHours??48} onChange={e=>setCfg(c=>c?{...c,windowHours:Number(e.target.value)}:c)}/></label>
        <label>Kelas minimum<select value={cfg?.minTier??'curated'} onChange={e=>setCfg(c=>c?{...c,minTier:e.target.value}:c)}><option value="radar">Radar (paling longgar)</option><option value="curated">Kurasi</option><option value="evidence_backed">Berbukti</option></select></label>
        <label>Ringkasan AI per putaran<input type="number" min={0} max={5} value={cfg?.aiPerRun??3} onChange={e=>setCfg(c=>c?{...c,aiPerRun:Number(e.target.value)}:c)}/></label>
        <button className="button" disabled={busy}>Simpan konfigurasi</button>
      </form>
      <p className="tiny">Pemicu dari Make / cron eksternal (token otomasi yang sama dengan Tahap 9):</p>
      <pre className="tiny">{`POST /api/hub/auto-editor?action=run\nAuthorization: Bearer <token otomasi>`}</pre>
      <p className="tiny">Ini menggantikan seluruh panel Tahap 9 untuk kebutuhan harian: satu panggilan = tarik RSS + olah + terbit + isi antrean sosial.</p>
    </details>

    {note&&<p role="status">{note}</p>}
    {err&&<p role="alert" className="notice error">{err}</p>}
  </section>;
}
