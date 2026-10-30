import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {getHubDb} from '@/server/hub/db/client';
import {prepareSocialSchema,claimBatch,acknowledge,socialStatus,enqueuePublished,issueSocialToken,revokeSocialToken,requeueFailed,verifySocialToken,SOCIAL_POLICY} from '@/server/hub/domain/social-pull';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const reply=(value:unknown)=>NextResponse.json(value,{headers:NO_STORE});
const MESSAGES:Record<string,string>={
  SOCIAL_NOT_READY:'Siapkan tabel antrean media sosial dahulu.',
  SOCIAL_TOKEN_INVALID:'Token tidak valid atau sudah dicabut.',
  SOCIAL_ACK_INVALID:'Ack tidak valid (deliveryKey 32 hex, maksimum 10 item).',
};
const msg=(e:unknown)=>MESSAGES[(e as Error)?.message||'']||'Permintaan media sosial gagal.';

export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{return reply({...await socialStatus(a.db),policy:{...SOCIAL_POLICY}});}catch{return errorJson('Status antrean sosial belum dapat dibaca.',503);}
}
export async function POST(request:Request){
  const url=new URL(request.url);const action=url.searchParams.get('action');
  const previewOk=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='webhub';

  // Make.com: pull & ack memakai bearer token, tanpa sesi/CSRF.
  if((action==='pull'||action==='ack')&&request.headers.get('authorization')){
    try{
      const db=getHubDb();
      if(!previewOk)return errorJson('Penarikan media sosial dibatasi Preview webhub.',403);
      if(!(await verifySocialToken(db,request.headers.get('authorization'))))return errorJson('Token tidak valid atau sudah dicabut.',401);
      if(action==='pull')return reply(await claimBatch(db,{max:Number(url.searchParams.get('max'))||undefined,label:'make'}));
      const body=await readJson(request);
      return reply(await acknowledge(db,body.results,'make'));
    }catch(e){return errorJson(msg(e),409);}
  }

  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(!previewOk)return errorJson('Pengelolaan media sosial dibatasi Preview webhub.',403);
  try{
    const b=await readJson(request);
    if(b.action==='prepare'){if(b.confirm!=='PREPARE SOCIAL')return errorJson('Konfirmasi diperlukan.',400);return reply(await prepareSocialSchema(a.db));}
    if(b.action==='enqueue'){if(b.confirm!=='ENQUEUE SOCIAL')return errorJson('Konfirmasi diperlukan.',400);return reply(await enqueuePublished(a.db));}
    if(b.action==='issueToken'){if(b.confirm!=='ISSUE SOCIAL TOKEN')return errorJson('Konfirmasi diperlukan.',400);return reply(await issueSocialToken(a.db,b.label));}
    if(b.action==='revokeToken'){if(b.confirm!=='REVOKE SOCIAL TOKEN')return errorJson('Konfirmasi diperlukan.',400);return reply(await revokeSocialToken(a.db,b.id));}
    if(b.action==='requeue'){if(b.confirm!=='REQUEUE SOCIAL')return errorJson('Konfirmasi diperlukan.',400);return reply(await requeueFailed(a.db));}
    if(b.action==='previewPull'){if(b.confirm!=='PREVIEW PULL')return errorJson('Konfirmasi diperlukan.',400);const out=await claimBatch(a.db,{max:4,label:'panel-preview'});await acknowledge(a.db,out.items.map(i=>({deliveryKey:i.deliveryKey,ok:false,error:'PANEL_PREVIEW'})),'panel-preview');return reply({...out,note:'Pratinjau tidak mengirim apa pun; item dikembalikan ke antrean sebagai failed untuk dicoba ulang.'});}
    return errorJson('Aksi tidak dikenal.',400);
  }catch(e){return errorJson(msg(e),409);}
}
