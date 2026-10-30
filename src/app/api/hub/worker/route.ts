import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {getHubDb} from '@/server/hub/db/client';
import {prepareWorkerSchema,enqueueTask,tick,workerStatus,recoverExpiredTasks,issueWorkerToken,revokeWorkerToken,verifyWorkerToken,TASK_KINDS} from '@/server/hub/domain/worker';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const reply=(value:unknown)=>NextResponse.json(value,{headers:NO_STORE});
const MESSAGES:Record<string,string>={
  WORKER_NOT_READY:'Siapkan tabel pekerja dahulu.',
  WORKER_KIND_INVALID:'Jenis tugas tidak diizinkan.',
  WORKER_PAYLOAD_INVALID:'Isi tugas tidak valid.',
  WORKER_QUEUE_FULL:'Antrean untuk jenis tugas ini penuh. Selesaikan dulu tugas yang ada.',
  WORKER_TOKEN_INVALID:'Token pekerja tidak valid atau sudah dicabut.',
  WORKER_PREREQUISITE:'Siapkan tabel Tahap 2/4/5 yang menjadi syarat tugas ini dahulu.',
  WORKER_QUOTA_OR_PROVIDER:'Kuota/penyedia AI belum siap; tugas dikembalikan ke antrean untuk dicoba lagi.',
};
const msg=(e:unknown)=>MESSAGES[e instanceof Error?e.message:'']||'Tugas pekerja gagal. Antrean dan log tersimpan; isi berita tidak diubah.';

export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{return reply({...await workerStatus(a.db),kinds:TASK_KINDS});}
  catch{return errorJson('Status pekerja belum dapat dibaca.',503);}
}
export async function POST(request:Request){
  const url=new URL(request.url);
  const action=url.searchParams.get('action');
  const previewOk=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='webhub';

  // Penjadwal eksternal: hanya tick, hanya dengan token pekerja, tanpa sesi dan tanpa CSRF.
  if(action==='tick'&&!request.headers.get('cookie')?.includes('hub_session=')&&request.headers.get('authorization')){
    try{
      const db=getHubDb();
      if(!previewOk)return errorJson('Pekerja dibatasi Preview webhub.',403);
      if(!(await verifyWorkerToken(db,request.headers.get('authorization'))))return errorJson('Token pekerja tidak valid atau sudah dicabut.',401);
      return reply(await tick(db,{maxTasks:1}));
    }catch(e){return errorJson(msg(e),409);}
  }

  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(!previewOk)return errorJson('Pekerja dibatasi Preview webhub.',403);
  try{
    const b=await readJson(request);
    if(b.action==='prepare'){if(b.confirm!=='PREPARE WORKER')return errorJson('Konfirmasi diperlukan.',400);return reply(await prepareWorkerSchema(a.db));}
    if(b.action==='enqueue'){
      if(b.confirm!=='ENQUEUE WORKER')return errorJson('Konfirmasi diperlukan.',400);
      const out=await enqueueTask(a.db,{kind:b.kind,payload:b.payload,idempotencyKey:b.idempotencyKey,maxAttempts:b.maxAttempts});
      return reply({...out,status:await workerStatus(a.db)});
    }
    if(b.action==='tick'){
      if(b.confirm!=='RUN WORKER')return errorJson('Konfirmasi diperlukan.',400);
      return reply(await tick(a.db,{maxTasks:Number(b.maxTasks)||undefined}));
    }
    if(b.action==='recover'){if(b.confirm!=='RECOVER WORKER')return errorJson('Konfirmasi diperlukan.',400);return reply(await recoverExpiredTasks(a.db));}
    if(b.action==='issueToken'){if(b.confirm!=='ISSUE WORKER TOKEN')return errorJson('Konfirmasi diperlukan.',400);return reply(await issueWorkerToken(a.db,b.label));}
    if(b.action==='revokeToken'){if(b.confirm!=='REVOKE WORKER TOKEN')return errorJson('Konfirmasi diperlukan.',400);return reply(await revokeWorkerToken(a.db,b.id));}
    return errorJson('Aksi tidak dikenal.',400);
  }catch(e){return errorJson(msg(e),409);}
}
