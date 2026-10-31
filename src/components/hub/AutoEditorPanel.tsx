'use client';
import {useCallback,useEffect,useState} from 'react';

type Step={step:string;ok:boolean;detail:string;count?:number;sources?:{id:string;name:string;ok:boolean;inserted:number;error?:string}[]};
type Run={trigger:string;status:string;pulled:number;selected:number;published:number;durationMs:number;at:string;steps:Step[]};
type Quick={configured:boolean;rssTotal:number;rssReady:number;rssActive:number;rightsConfirmed:number;editorEnabled:boolean;publishTarget?:'dedicated'|'fallback'|'none';hint:string};
type Status={
  ready:boolean;quick:Quick|null;
  config:{enabled:boolean;maxPerRun:number;maxPerDay:number;windowHours:number;minTier:string;regions:string[];aiPerRun:number};
  runs:Run[];sources:{total:number;permissionConfirmed:number;metadataOnly:number;unknown:number};publishedToday:number;
  policy:{hardMaxPerRun:number;hardMaxPerDay:number};
};

async function api(body:Record<string,unknown>){
  const r=await fetch('/api/hub/auto-editor',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-Hub-Request':'1'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({error:'Respons tidak terbaca'}));
  if(!r.ok)throw Error(j.error||'Permintaan gagal');
  return j;
}

export default function AutoEditorPanel(){
  const [st,setSt]=useState<Status|null>(null);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');
  const [err,setErr]=useState('');
  const [adv,setAdv]=useState(false);
  const [result,setResult]=useState<{included:number;skipped:number;tokens:{automation?:string;social?:string};next:string[]}|null>(null);
  const [cfg,setCfg]=useState<Status['config']|null>(null);

  const load=useCallback(async()=>{
    try{const r=await fetch('/api/hub/auto-editor',{credentials:'same-origin',cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error);setSt(j);setCfg(j.config);}
    catch(e){setErr(e instanceof Error?e.message:'Gagal memuat status');}
  },[]);
  useEffect(()=>{void load();},[load]);

  async function run(fn:()=>Promise<unknown>,ok:string){
    setBusy(true);setErr('');setNote('');
    try{await fn();setNote(ok);await load();}
    catch(e){setErr(e instanceof Error?e.message:'Gagal');}
    finally{setBusy(false);}
  }

  const q=st?.quick;
  const on=st?.config.enabled===true;
  const last=st?.runs?.[0];

  function sekaliAtur(){
    if(!window.confirm('Sekali Atur akan:\n• mengaktifkan semua sumber RSS yang feed-nya sudah terverifikasi\n• menandai haknya PERMISSION CONFIRMED (pernyataan Anda bahwa pengambilan + penerbitan boleh)\n• menyiapkan semua tabel\n• menyalakan redaktur otomatis\n• menerbitkan 2 token (tampil sekali)\n\nKetik: SIAPKAN SEMUA')){
      return;
    }
    setBusy(true);setErr('');setNote('');setResult(null);
    api({action:'quickSetup',confirm:'SIAPKAN SEMUA',rights:'permission_confirmed',enable:true,issueTokens:true})
      .then((j:any)=>{
        setResult({included:j.sources?.included?.length??0,skipped:j.sources?.skipped?.length??0,tokens:j.tokens||{},next:j.next||[]});
        setNote('Selesai. Redaktur aktif dan tabel siap.');
        return load();
      })
      .catch(e=>setErr(e instanceof Error?e.message:'Gagal'))
      .finally(()=>setBusy(false));
  }

  return <section aria-label="Redaktur otomatis">
    <h2>Redaktur Otomatis <span className="tiny">(Tahap 10)</span></h2>

    <div className="notice" role="status">
      <p><b>{on?'AKTIF':'NONAKTIF'}</b> · {q?`${q.rightsConfirmed} dari ${q.rssReady} feed siap berhak terkonfirmasi`:'—'} · terbit hari ini {st?.publishedToday??0}/{st?.config.maxPerDay??0}</p>
      <p className="tiny">{q?.hint||'Menyiapkan status…'}</p>
      <p className="tiny">Tujuan terbit: {q?.publishTarget==='dedicated'?'terkonfigurasi penuh (HUB_WEBSITE_*)':q?.publishTarget==='fallback'?'otomatis memakai kredensial situs yang sudah ada':'BELUM terkonfigurasi — artikel tidak akan masuk ke portal'}</p>
    </div>

    <div className="form-actions">
      <button className="button" disabled={busy} onClick={sekaliAtur}>⚡ Sekali Atur (siapkan + aktifkan)</button>
      <button className="button" disabled={busy||!st?.ready} onClick={()=>void run(()=>api({action:'run',confirm:'RUN AUTO EDITOR'}),'Putaran selesai.')}>▶ Jalankan sekarang</button>
      {on&&<button className="button secondary" disabled={busy} onClick={()=>void run(()=>api({action:'disable'}),'Redaktur dimatikan. Tidak ada yang terbit pada putaran berikutnya.')}>Matikan</button>}
      <button className="button secondary" disabled={busy} onClick={()=>void load()}>Muat ulang</button>
    </div>
    <p className="tiny">Satu tombol cukup untuk pemakaian sehari-hari. Semua langkah lain ada di <b>Lanjutan</b> di bawah.</p>

    {result&&<div className="notice">
      <p><b>Sekali Atur selesai:</b> {result.included} sumber disiapkan, {result.skipped} dilewati.</p>
      {(result.tokens.automation||result.tokens.social)&&<>
        <p className="tiny">Salin sekarang — tidak akan ditampilkan lagi:</p>
        {result.tokens.automation&&<p className="tiny">Token otomasi: <code>{result.tokens.automation}</code></p>}
        {result.tokens.social&&<p className="tiny">Token sosial: <code>{result.tokens.social}</code></p>}
      </>}
      <ul className="tiny">{result.next.map((n,i)=><li key={i}>{n}</li>)}</ul>
    </div>}

    {last&&<div className="notice">
      <p><b>Putaran terakhir:</b> {last.status} · ditarik {last.pulled} · dipilih {last.selected} · terbit {last.published} · {Math.round(last.durationMs/1000)}s</p>
      <ol className="tiny">{last.steps.map((s,i)=><li key={i}>{s.ok?'✔':'✖'} {s.step}: {s.detail}
        {!!s.sources?.length&&<ul>{s.sources.map(x=><li key={x.id}>{x.ok?'•':'✖'} {x.name}: {x.ok?`${x.inserted} berita baru`:`gagal (${x.error})`}</li>)}</ul>}
      </li>)}</ol>
    </div>}

    <details open={adv} onToggle={e=>setAdv((e.target as HTMLDetailsElement).open)}><summary>Lanjutan: kriteria, konfigurasi &amp; pemicu</summary>
      <form className="form-grid" onSubmit={e=>{e.preventDefault();if(!cfg)return;void run(()=>api({action:'config',confirm:'SIMPAN KONFIGURASI EDITOR',config:cfg}),'Konfigurasi disimpan.');}}>
        <label>Maksimum terbit per putaran<input type="number" min={1} max={st?.policy.hardMaxPerRun??12} value={cfg?.maxPerRun??8} onChange={e=>setCfg(c=>c?{...c,maxPerRun:Number(e.target.value)}:c)}/></label>
        <label>Maksimum per hari<input type="number" min={1} max={st?.policy.hardMaxPerDay??60} value={cfg?.maxPerDay??40} onChange={e=>setCfg(c=>c?{...c,maxPerDay:Number(e.target.value)}:c)}/></label>
        <label>Umur berita (jam)<input type="number" min={1} max={168} value={cfg?.windowHours??48} onChange={e=>setCfg(c=>c?{...c,windowHours:Number(e.target.value)}:c)}/></label>
        <label>Kelas minimum<select value={cfg?.minTier??'curated'} onChange={e=>setCfg(c=>c?{...c,minTier:e.target.value}:c)}><option value="radar">Radar (paling longgar)</option><option value="curated">Kurasi</option><option value="evidence_backed">Berbukti</option></select></label>
        <label>Ringkasan AI per putaran<input type="number" min={0} max={5} value={cfg?.aiPerRun??3} onChange={e=>setCfg(c=>c?{...c,aiPerRun:Number(e.target.value)}:c)}/></label>
        <button className="button" disabled={busy}>Simpan konfigurasi</button>
      </form>
      <p className="tiny">Bila beranda terasa kurang terisi: naikkan umur berita atau turunkan kelas minimum. Itu keputusan editorial Anda, bukan default sistem.</p>
      <p className="tiny">Pemicu otomatis (salah satu):</p>
      <pre className="tiny">{`POST /api/hub/auto-editor?action=run\nAuthorization: Bearer <token otomasi>`}</pre>
      <p className="tiny">Pakai GitHub Actions (berkas .github/workflows/hub-tick.yml di paket) atau Make — keduanya memanggil endpoint yang sama.</p>
    </details>

    {note&&<p role="status">{note}</p>}
    {err&&<p role="alert" className="notice error">{err}</p>}
  </section>;
}
