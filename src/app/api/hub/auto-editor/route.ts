import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {getHubDb} from '@/server/hub/db/client';
import {verifyAutomationToken} from '@/server/hub/domain/automation';
import {prepareAutoEditor,saveAutoConfig,setAutoEditor,setRightsMode,autoEditorStatus,runAutoEditor,AUTO_EDITOR_POLICY} from '@/server/hub/domain/auto-editor';
import {quickSetup,quickStatus,QUICK_SETUP_CONFIRM} from '@/server/hub/domain/quick-setup';
import {diagnosePull} from '@/server/hub/domain/pull-diagnose';
import {diagnoseSelection} from '@/server/hub/domain/selection-diagnose';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const reply=(value:unknown)=>NextResponse.json(value,{headers:NO_STORE});
const MESSAGES:Record<string,string>={
  AUTO_EDITOR_NOT_READY:'Siapkan tabel redaktur otomatis dahulu.',
  CONFIRM_REQUIRED:'Konfirmasi teks tidak cocok.',
};
const msg=(e:unknown)=>MESSAGES[(e as Error)?.message||'']||'Redaktur otomatis gagal; langkah yang sudah selesai tetap tersimpan.';
const previewOk=()=>process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='webhub';

export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{return reply({...await autoEditorStatus(a.db),quick:await quickStatus(a.db).catch(()=>null),policy:{...AUTO_EDITOR_POLICY}});}catch{return errorJson('Status redaktur otomatis belum dapat dibaca.',503);}
}

export async function POST(request:Request){
  const url=new URL(request.url);const action=url.searchParams.get('action');

  // Satu endpoint untuk Make/cron/manual bertoken: cukup satu pemicu.
  if(action==='run'&&!request.headers.get('cookie')?.includes('hub_session=')&&request.headers.get('authorization')){
    try{
      const db=getHubDb();
      if(!previewOk())return errorJson('Redaktur otomatis dibatasi Preview webhub.',403);
      if(!(await verifyAutomationToken(db,request.headers.get('authorization'))))return errorJson('Token tidak valid atau sudah dicabut.',401);
      return reply(await runAutoEditor(db,{trigger:'scheduler',master:process.env.HUB_MASTER_KEY}));
    }catch(e){return errorJson(msg(e),409);}
  }

  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(!previewOk())return errorJson('Redaktur otomatis dibatasi Preview webhub.',403);
  try{
    const b=await readJson(request);
    if(b.action==='quickSetup'){return reply(await quickSetup(a.db,{rights:b.rights,enable:b.enable,issueTokens:b.issueTokens,minTier:b.minTier,windowHours:b.windowHours,actor:'owner',confirm:b.confirm}));}
    if(b.action==='diagnose'){return reply(await diagnosePull(a.db));}
    if(b.action==='diagnoseSelection'){return reply(await diagnoseSelection(a.db));}
    if(b.action==='prepare'){if(b.confirm!=='PREPARE AUTO EDITOR')return errorJson('Konfirmasi diperlukan.',400);return reply(await prepareAutoEditor(a.db));}
    if(b.action==='config'){if(b.confirm!=='SIMPAN KONFIGURASI EDITOR')return errorJson('Konfirmasi diperlukan.',400);return reply({config:await saveAutoConfig(a.db,(b.config||{}) as Record<string,unknown>,'owner')});}
    if(b.action==='enable'||b.action==='disable'){return reply({config:await setAutoEditor(a.db,b.action==='enable',b.confirm,'owner')});}
    if(b.action==='rightsMode'){return reply({config:await setRightsMode(a.db,b.mode,b.confirm,'owner')});}
    if(b.action==='run'){if(b.confirm!=='RUN AUTO EDITOR')return errorJson('Konfirmasi diperlukan.',400);return reply(await runAutoEditor(a.db,{trigger:'manual',master:process.env.HUB_MASTER_KEY}));}
    return errorJson('Aksi tidak dikenal.',400);
  }catch(e){const code=((e as Error)?.message||'').replace(/[^A-Z0-9_]/g,'').slice(0,40);return errorJson(code?`${msg(e)} [${code}]`:msg(e),409);}
}
