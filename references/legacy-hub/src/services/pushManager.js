const {execFile}=require('child_process');
const path=require('path');
function createPushManager({execute=execFile,env=process.env,locks=new Set()}={}){
 let state={status:'idle',startedAt:null,finishedAt:null,result:null,error:null};
 const snapshot=()=>({...state,configured:!!env.CONTENT_HUB_PUSH_URL&&!!env.CONTENT_HUB_PUSH_SECRET});
 function start(){
  if(locks.size){const e=Error('Proses lain sedang berjalan');e.status=409;throw e;}
  if(!env.CONTENT_HUB_PUSH_URL||!env.CONTENT_HUB_PUSH_SECRET){const e=Error('Konfigurasi push belum lengkap');e.status=503;throw e;}
  locks.add('push');state={status:'running',startedAt:new Date().toISOString(),finishedAt:null,result:null,error:null};
  try{execute(process.execPath,[path.join(__dirname,'../../scripts/push-vercel.js')],{cwd:path.join(__dirname,'../..'),env,timeout:180000,maxBuffer:64000},(error,stdout)=>{
   try{
    const line=String(stdout||'').trim().split('\n').reverse().find(l=>l.startsWith('{'));
    const parsed=line?JSON.parse(line):null;
    // Never surface raw child output, URLs, headers, or credentials.
    const result=parsed?{found:Number(parsed.found)||0,inserted:Number(parsed.inserted)||0,skipped:Number(parsed.skipped)||0,snapshots:Array.isArray(parsed.snapshots)?parsed.snapshots.filter(s=>['recommended','x-trends','youtube-music'].includes(s)):[],errorCount:Array.isArray(parsed.errors)?parsed.errors.length:0}:null;
    state={...state,status:error?(result?'partial':'failed'):'success',finishedAt:new Date().toISOString(),result,error:error?'Pengiriman tidak selesai sepenuhnya. Periksa konfigurasi, proteksi Preview, dan log backend tanpa membagikan secret.':null};
   }catch{state={...state,status:'failed',finishedAt:new Date().toISOString(),error:'Hasil pengiriman tidak valid'};}
   finally{locks.delete('push');}
  });}catch{locks.delete('push');state={...state,status:'failed',finishedAt:new Date().toISOString(),error:'Gagal memulai pengiriman'};throw Error('Gagal memulai pengiriman');}
  return snapshot();
 }
 return {snapshot,start};
}
module.exports={createPushManager};
