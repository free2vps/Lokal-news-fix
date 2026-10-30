'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';

async function request(body?:Record<string,unknown>,query=''){
 const r=await fetch('/api/hub/value'+(body?'':query),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{'X-Hub-Request':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Nilai editorial belum tersedia.');return j;
}
const TIER:Record<string,{label:string;hint:string}>={radar:{label:'Radar',hint:'Sinyal mentah/populer—bukan bukti kebenaran.'},curated:{label:'Kurasi',hint:'Ada olah editorial atau metadata pendukung.'},evidence_backed:{label:'Berbukti',hint:'Bukti berlapis: observasi/olahan manusia plus kesepakatan sumber.'}};

export function ValueManager({onCompleted}:{onCompleted?:()=>void}){
 const [status,setStatus]=useState<{ready:boolean;total:number;stored:number;tiers:Record<string,number>}|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[cursor,setCursor]=useState('');const stop=useRef(false);
 const load=useCallback(async()=>{try{setStatus((await request()).status);}catch(e){setMessage(e instanceof Error?e.message:'Status belum dapat dibaca.');}},[]);
 useEffect(()=>{void load();return()=>{stop.current=true;};},[load]);
 async function run(){
  if(!window.confirm('Hitung nilai tambah editorial (radar / kurasi / berbukti) untuk seluruh berita? Berbasis metadata yang sudah ada, tanpa AI/API, tanpa mengubah isi berita dan tanpa publikasi. Biarkan tab terbuka sampai selesai.'))return;
  stop.current=false;setBusy(true);let next=cursor,processed=0;
  try{if(!status?.ready)await request({action:'prepare',confirm:'PREPARE VALUES'});
   do{const result=await request({action:'batch',cursor:next});processed+=result.processed;next=result.nextCursor||'';setCursor(next);setMessage(`Dinilai ${processed} berita. ${result.nextCursor?'Melanjutkan batch…':'Selesai.'}`);if(!result.nextCursor)break;}while(!stop.current);
   await load();onCompleted?.();
  }catch(e){setMessage(e instanceof Error?e.message:'Gagal; batch sebelumnya tetap tersimpan.');await load();}finally{setBusy(false);}}
 return <section className="panel"><h2>Tahap 5 · Nilai tambah editorial</h2>
  <p>Kelas nilai: <b>Radar</b> (sinyal mentah) → <b>Kurasi</b> (ada olah editorial) → <b>Berbukti</b> (observasi/olahan manusia + kesepakatan antar sumber). Dinilai: {status?status.stored:'—'} / {status?status.total:'—'}.</p>
  <div className="form-actions"><button className="button" disabled={busy} onClick={()=>void run()}>{busy?'Menilai…':cursor?'Lanjutkan penilaian':'Hitung nilai seluruh berita'}</button>{busy&&<button className="button secondary" onClick={()=>{stop.current=true;}}>Berhenti setelah batch</button>}<button className="button secondary" disabled={busy} onClick={()=>void load()}>Perbarui</button></div>
  <p className="tiny">25 berita/batch, aman diulang, tanpa AI. Parafrase AI tidak pernah menaikkan kelas menjadi “Berbukti”. Radar bukan bukti kebenaran; kelas ini bukan verifikasi fakta, bukan penilaian originalitas, dan bukan jaminan AdSense. Tidak ada publikasi.</p>
  {status?.ready&&<p className="tiny">Saat ini: {Object.entries(status.tiers||{}).map(([k,v])=>`${TIER[k]?.label||k} ${v}`).join(' · ')||'belum ada hasil'}.</p>}
  {message&&<p role="status">{message}</p>}</section>;
}

export function ItemValue({id,revision}:{id:string;revision:number}){
 const [open,setOpen]=useState(false),[data,setData]=useState<any>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{setData((await request(undefined,'?id='+encodeURIComponent(id))).item);setMessage('');}catch(e){setMessage(e instanceof Error?e.message:'Nilai belum tersedia.');}},[id]);
 useEffect(()=>{if(open)void load();},[open,load,revision]);
 async function compute(){setBusy(true);try{await request({action:'batch',id});await load();}catch(e){setMessage(e instanceof Error?e.message:'Siapkan tabel nilai melalui panel Tahap 5.');}finally{setBusy(false);}}
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>Nilai tambah editorial</summary>{open&&<><button type="button" className="button secondary" disabled={busy} onClick={()=>void compute()}>{data?.stored?'Hitung ulang nilai':'Hitung nilai berita ini'}</button>{message&&<p role="status">{message}</p>}{data&&<ValueDetails data={data}/>}</>}</details>;
}

export function ValueDetails({data}:{data:any}){
 const v=data.value;const c=v.components||{};
 return <section aria-label="Nilai tambah editorial">
  <p><b>{v.tierLabel}</b> · skor {v.score}/100. {TIER[v.tier]?.hint}</p>
  {data.stale&&<p role="status">NILAI PERLU DIHITUNG ULANG: metadata/versi berita berubah setelah penilaian.</p>}
  <ul><li>Bukti observasi: {c.evidantary ?? c.evidentiary}/30 · observasi {v.signals.observations}×</li><li>Olah editorial: {c.editorialWork}/25 · {v.signals.humanEdited?'ada suntingan manusia':'belum ada'}</li><li>Kekhususan wilayah: {c.regionalSpecificity}/15 · {v.signals.profileRegions?.join(', ')||'belum diketahui'}</li><li>Kegunaan praktis: {c.usefulness}/15 · {v.signals.usefulness?.join(', ')||'belum diketahui'}</li><li>Kesepakatan sumber: {c.corroboration}/15 · {v.signals.corroboratingSources} sumber{v.signals.corroboratingNames?.length?` (${v.signals.corroboratingNames.join(', ')})`:''}</li></ul>
  <p><b>Nilai tambah:</b> olah manusia {v.addedValue?.humanEdit?'ada':'belum'}, lapisan bukti {v.addedValue?.evidenceLayers}/3.{v.signals.aiSummaryOnly?' Ringkasan AI saja tidak dihitung sebagai nilai tambah.':''}</p>
  {v.blockers?.length>0&&<><p><b>Penghalang kenaikan kelas:</b></p><ul>{v.blockers.map((b:string)=><li key={b}>{b}</li>)}</ul></>}
  <p className="tiny">Status originalitas: {v.originalityStatus}. Kesesuaian AdSense: {v.adsenseSuitability}. Kelas ini bukan verifikasi fakta dan bukan jaminan pendapatan; publikasi tetap nonaktif.</p>
 </section>;
}
