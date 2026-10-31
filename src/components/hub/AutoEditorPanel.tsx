'use client';
import {useCallback,useEffect,useState} from 'react';

type Step={step:string;ok:boolean;detail:string;count?:number;sources?:{id:string;name:string;ok:boolean;inserted:number;error?:string;processed?:number;skipped?:number;invalid?:number}[]};
type Run={trigger:string;status:string;pulled:number;selected:number;published:number;durationMs:number;at:string;steps:Step[]};
type DiagItem={title:string;state:string;dateOk:boolean;published:string|null;dateRaw:string|null};
type Diag={at:string;windowHours:number;verdict:string;totals:{feedItems:number;siap:number;duplikat:number;tidak_valid:number};rights:Record<string,number>;
  sources:{id:string;name:string;feedUrl:string|null;ok:boolean;error?:string;rights:string;feedItems:number;inWindow:number|null;counts:Record<string,number>;samples:DiagItem[];newestFeedAt:string|null;newestStoredAt:string|null;newestStoredTitle:string|null}[]};
type SelGate={key:string;label:string;dropped:number;remaining:number};
type SelDiag={at:string;windowHours:number;rightsMode:string;allowedRegions:string[];totalItems:number;rowsScanned:number;survivors:number;rules?:{key:string;label:string}[];
  gates:SelGate[];byTier:Record<string,number>;byRegion:Record<string,number>;verdict:string;suggestion:string;
  sources:{id:string;name:string;region:string;rights:string;active:boolean;items:number;inWindow:number;passAll:boolean;blockedBy:string|null}[];
  rightsSummary:{total:number;permissionConfirmed:number;metadataOnly:number;unknown:number;inactive:number};
  regionalSurvivors:number;nationalSurvivors:number;
  plan:{capacity:number;mixRegionalPct:number;regionalAvailable:number;nationalAvailable:number;regionalWillTake:number;nationalWillTake:number}};
type Quick={configured:boolean;rssTotal:number;rssReady:number;rssActive:number;rightsConfirmed:number;editorEnabled:boolean;publishTarget?:'dedicated'|'fallback'|'none';hint:string};
type Status={
  ready:boolean;quick:Quick|null;
  config:{enabled:boolean;maxPerRun:number;maxPerDay:number;windowHours:number;minTier?:string;regions:string[];aiPerRun:number;mixRegionalPct?:number};
  selectionRules?:{key:string;label:string}[];
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
  const [diag,setDiag]=useState<Diag|null>(null);
  const [sel,setSel]=useState<SelDiag|null>(null);
  const [reasons,setReasons]=useState<Record<string,number>|null>(null);

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
      <button className="button" disabled={busy||!st?.ready} onClick={()=>void run(async()=>{const j=await api({action:'run',confirm:'RUN AUTO EDITOR'});setReasons((j as {reasons?:Record<string,number>}).reasons||null);return j;},'Putaran selesai.')}>▶ Jalankan sekarang</button>
      {on&&<button className="button secondary" disabled={busy} onClick={()=>void run(()=>api({action:'disable'}),'Redaktur dimatikan. Tidak ada yang terbit pada putaran berikutnya.')}>Matikan</button>}
    </div>
    <p className="tiny"><b>{on ? (q && q.rightsConfirmed > 0 ? 'Siap. Tekan "Jalankan sekarang" untuk menerbitkan sekali, atau biarkan penjadwal 3 jam bekerja.' : 'Belum bisa terbit: belum ada sumber yang saklarnya menyala di RSS Manager.') : 'Aktifkan redaktur dulu dengan tombol di atas.'}</b> Semua langkah lain ada di <b>Lanjutan</b>.</p>

    <div className="notice">
      <p><b>Syarat terbit</b> <span className="tiny">(semua harus ya — tidak ada skor yang menentukan)</span></p>
      <ul className="tiny">{(st?.selectionRules??[]).map(r=><li key={r.key}>• {r.label}</li>)}</ul>
      <p className="tiny">Skor mutu (dulu disebut radar/kurasi) tetap dihitung sebagai informasi di menu <b>Tinjau Manual</b>, tetapi tidak lagi menjadi syarat terbit.</p>
    </div>

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
        {!!s.sources?.length&&<ul>{s.sources.map(x=><li key={x.id}>{x.ok?'•':'✖'} {x.name}: {x.ok?`${x.inserted} baru dari ${x.processed??0} item${x.skipped?` · ${x.skipped} duplikat`:''}${x.invalid?` · ${x.invalid} tidak valid`:''}`:`gagal (${x.error})`}</li>)}</ul>}
      </li>)}</ol>
    </div>}

    {sel&&<div className="notice">
      <p><b>Diagnosa seleksi</b> <button className="button secondary" onClick={()=>setSel(null)}>tutup</button></p>
      <p><b>{sel.verdict}</b></p>
      <p className="tiny">{sel.rowsScanned} dari {sel.totalItems} kandidat diperiksa · umur berita {sel.windowHours} jam · wilayah {sel.allowedRegions.join(', ')} · hanya baca</p>
      <p className="tiny"><b>Hak sumber aktif:</b> {sel.rightsSummary.permissionConfirmed} terkonfirmasi · {sel.rightsSummary.metadataOnly} metadata saja · {sel.rightsSummary.unknown} belum jelas · {sel.rightsSummary.inactive} nonaktif (total {sel.rightsSummary.total})</p>
      {sel.rightsSummary.permissionConfirmed===0&&<p className="tiny"><b>Ini penyebab utama:</b> belum ada satu pun sumber berstatus "hak terkonfirmasi", sedangkan mode hak = {sel.rightsMode}. Semua berita segar akan selalu gugur. Tandai "Hak pakai" di tab RSS Manager untuk sumber yang Anda nilai boleh.</p>}
      <table className="tiny"><thead><tr><th>Saringan</th><th>Gugur</th><th>Tersisa</th></tr></thead><tbody>
        {sel.gates.map(g=><tr key={g.key}><td>{g.label}</td><td>{g.dropped}</td><td>{g.remaining}</td></tr>)}
      </tbody></table>
      <p className="tiny">Kelas: {Object.entries(sel.byTier).map(([k,v])=>`${k} ${v}`).join(' · ')||'—'} · Wilayah: {Object.entries(sel.byRegion).map(([k,v])=>`${k} ${v}`).join(' · ')||'—'}</p>
      <p className="tiny"><b>Porsi terbit:</b> target {sel.plan.mixRegionalPct}% daerah · tersedia {sel.regionalSurvivors} daerah + {sel.nationalSurvivors} nasional · putaran berikutnya akan mengambil ±{sel.plan.regionalWillTake} daerah + {sel.plan.nationalWillTake} nasional (kapasitas {sel.plan.capacity})</p>
      <p><b>Saran:</b> {sel.suggestion}</p>
      {!!sel.sources.length&&<details><summary className="tiny">Rincian per sumber ({sel.sources.length})</summary>
        <ul className="tiny">{sel.sources.map(x=><li key={x.id}>{x.passAll?'✔':'✖'} <b>{x.name}</b> ({x.region||'-'} · {x.rights}) — {x.items} kandidat, {x.inWindow} dalam jendela{x.blockedBy?` · terblokir: ${x.blockedBy}`:' · lolos'}</li>)}</ul>
      </details>}
      <p className="tiny">Diagnosa ini tidak mengubah konfigurasi apa pun. Semua angka dihitung dengan saringan yang sama seperti putaran terbit.</p>
    </div>}

    {diag&&<div className="notice">
      <p><b>Diagnosa tarikan</b> <button className="button secondary" onClick={()=>setDiag(null)}>tutup</button></p>
      <p><b>{diag.verdict}</b></p>
      <p className="tiny">{diag.totals.feedItems} item dibaca · {diag.totals.siap} baru · {diag.totals.duplikat} duplikat · {diag.totals.tidak_valid} tidak valid · jendela {diag.windowHours} jam · hanya baca</p>
      <ul className="tiny">{diag.sources.map(s=><li key={s.id}>
        {s.ok?'•':'✖'} <b>{s.name}</b> <span className="tiny">[{s.rights}]</span>{s.ok?` — ${s.feedItems} item di feed · ${s.counts.siap??0} baru · ${(s.counts.duplikat_url??0)+(s.counts.duplikat_identitas??0)} duplikat · ${(s.counts.url_invalid??0)+(s.counts.judul_kosong??0)} tidak valid · tersimpan ${s.inWindow??'?'} item dalam ${diag.windowHours} jam · terbaru di feed ${s.newestFeedAt?String(s.newestFeedAt).slice(0,16).replace('T',' '):'—'} · terbaru tersimpan ${s.newestStoredAt?String(s.newestStoredAt).slice(0,16).replace('T',' '):'—'}`:` — gagal (${s.error})`}
        {s.ok&&s.feedUrl&&<div className="tiny">feed: <code>{s.feedUrl}</code></div>}
        {!!s.samples.length&&<ul>{s.samples.map((it,i)=><li key={i} className="tiny">{it.state==='siap'?'✔ baru':'· '+it.state}: {it.title||'(tanpa judul)'} — {it.dateOk?String(it.published).slice(0,16).replace('T',' '):'tanggal tidak terbaca'}</li>)}</ul>}
      </li>)}</ul>
      <p className="tiny">Tidak ada satu baris pun yang ditulis ke database oleh diagnosa ini. Bila hasilnya "semua duplikat", redaktur memang benar: belum ada artikel baru di feed sejak tarikan terakhir.</p>
    </div>}

    <details open={adv} onToggle={e=>setAdv((e.target as HTMLDetailsElement).open)}><summary>Lanjutan: kriteria, konfigurasi, pemicu &amp; alat bantu</summary>
      <div className="form-actions">
        <button className="button secondary" disabled={busy} onClick={()=>void run(async()=>setDiag(await api({action:'diagnose'})),'Diagnosa selesai — tidak ada yang ditulis ke database.')}>🔍 Diagnosa tarikan</button>
        <button className="button secondary" disabled={busy} onClick={()=>void run(async()=>setSel(await api({action:'diagnoseSelection'})),'Diagnosa seleksi selesai — tidak ada yang ditulis ke database.')}>🔎 Kenapa 0 terbit?</button>
      </div>
      <form className="form-grid" onSubmit={e=>{e.preventDefault();if(!cfg)return;void run(()=>api({action:'config',confirm:'SIMPAN KONFIGURASI EDITOR',config:cfg}),'Konfigurasi disimpan.');}}>
        <label>Maksimum terbit per putaran<input type="number" min={1} max={st?.policy.hardMaxPerRun??12} value={cfg?.maxPerRun??8} onChange={e=>setCfg(c=>c?{...c,maxPerRun:Number(e.target.value)}:c)}/></label>
        <label>Maksimum per hari<input type="number" min={1} max={st?.policy.hardMaxPerDay??60} value={cfg?.maxPerDay??40} onChange={e=>setCfg(c=>c?{...c,maxPerDay:Number(e.target.value)}:c)}/></label>
        <label>Umur berita (jam)<input type="number" min={1} max={168} value={cfg?.windowHours??48} onChange={e=>setCfg(c=>c?{...c,windowHours:Number(e.target.value)}:c)}/></label>

        <label>Porsi berita daerah (%)<input type="number" min={0} max={100} value={cfg?.mixRegionalPct??60} onChange={e=>setCfg(c=>c?{...c,mixRegionalPct:Number(e.target.value)}:c)}/></label>
        <label>Ringkasan AI per putaran<input type="number" min={0} max={5} value={cfg?.aiPerRun??3} onChange={e=>setCfg(c=>c?{...c,aiPerRun:Number(e.target.value)}:c)}/></label>
        <button className="button" disabled={busy}>Simpan konfigurasi</button>
      </form>
      <p className="tiny">Porsi daerah/nasional hanya mengatur <b>campuran</b>, bukan syarat. Bila beranda terasa kurang terisi: perbesar umur berita, atau nyalakan lebih banyak sumber di RSS Manager.</p>
      <p className="tiny">Pemicu otomatis (salah satu):</p>
      <pre className="tiny">{`POST /api/hub/auto-editor?action=run\nAuthorization: Bearer <token otomasi>`}</pre>
      <p className="tiny">Pakai GitHub Actions (berkas .github/workflows/hub-tick.yml di paket) atau Make — keduanya memanggil endpoint yang sama.</p>
    </details>

    {reasons&&Object.keys(reasons).length>0&&<div className="notice"><p className="tiny"><b>Alasan gugur putaran terakhir:</b> {Object.entries(reasons).map(([k,v])=>`${k} (${v})`).join(' · ')}</p></div>}
    {note&&<p role="status">{note}</p>}
    {last&&(last as unknown as {storeError?:string}).storeError&&<p role="alert" className="notice error">Putaran selesai tetapi riwayat putaran gagal disimpan (RUN_LOG_UNAVAILABLE). Langkah di atas tetap dijalankan.</p>}
    {err&&<p role="alert" className="notice error">{err}</p>}
  </section>;
}
