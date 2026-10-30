import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {getHubDb} from '@/server/hub/db/client';
import {prepareAutomationSchema,runAutomation,automationStatus,issueAutomationToken,revokeAutomationToken,verifyAutomationToken,AUTOMATION_POLICY} from '@/server/hub/domain/automation';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const reply=(value:unknown)=>NextResponse.json(value,{headers:NO_STORE});
const MESSAGES:Record<string,string>={
  AUTOMATION_NOT_READY:'Siapkan tabel otomasi dahulu.',
  AUTOMATION_TOKEN_INVALID:'Token otomasi tidak valid atau sudah dicabut.',
};
const msg=(e:unknown)=>MESSAGES[(e as Error)?.message||'']||'Otomasi gagal; langkah yang sudah selesai tetap tersimpan.';

export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{return reply({...await automationStatus(a.db),policy:AUTOMATION_POLICY});}catch{return errorJson('Status otomasi belum dapat dibaca.',503);}
}
export async function POST(request:Request){
  const url=new URL(request.url);const action=url.searchParams.get('action');
  const previewOk=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='webhub';

  // Skeduler eksternal (Make/GitHub Actions/cron-job.org): hanya run, hanya dengan token.
  if(action==='run'&&!request.headers.get('cookie')?.includes('hub_session=')&&request.headers.get('authorization')){
    try{
      const db=getHubDb();
      if(!previewOk)return errorJson('Otomasi dibatasi Preview webhub.',403);
      if(!(await verifyAutomationToken(db,request.headers.get('authorization'))))return errorJson('Token otomasi tidak valid atau sudah dicabut.',401);
      return reply(await runAutomation(db,{trigger:'scheduler',master:process.env.HUB_MASTER_KEY}));
    }catch(e){return errorJson(msg(e),409);}
  }

  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(!previewOk)return errorJson('Otomasi dibatasi Preview webhub.',403);
  try{
    const b=await readJson(request);
    if(b.action==='prepare'){if(b.confirm!=='PREPARE AUTOMATION')return errorJson('Konfirmasi diperlukan.',400);return reply(await prepareAutomationSchema(a.db));}
    if(b.action==='run'){if(b.confirm!=='RUN AUTOMATION')return errorJson('Konfirmasi diperlukan.',400);return reply(await runAutomation(a.db,{trigger:'manual',master:process.env.HUB_MASTER_KEY}));}
    if(b.action==='issueToken'){if(b.confirm!=='ISSUE AUTOMATION TOKEN')return errorJson('Konfirmasi diperlukan.',400);return reply(await issueAutomationToken(a.db,b.label));}
    if(b.action==='revokeToken'){if(b.confirm!=='REVOKE AUTOMATION TOKEN')return errorJson('Konfirmasi diperlukan.',400);return reply(await revokeAutomationToken(a.db,b.id));}
    return errorJson('Aksi tidak dikenal.',400);
  }catch(e){return errorJson(msg(e),409);}
}
