import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {preparePublishSchema,readConfig,buildPlan,dryRun,arm,disarm,publishArmed,publishStatus,updateConfig,PUBLISH_POLICY} from '@/server/hub/domain/publish-policy';
import {supabaseDeliver} from '@/server/hub/domain/publish-delivery';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const reply=(value:unknown)=>NextResponse.json(value,{headers:NO_STORE});
const MESSAGES:Record<string,string>={
  PUBLISH_NOT_READY:'Siapkan tabel autopublish dahulu.',
  PUBLISH_CONFIRM_REQUIRED:'Konfirmasi teks belum sesuai.',
  PUBLISH_PLAN_INVALID:'Hash rencana tidak valid.',
  PUBLISH_ALLOWLIST_EMPTY:'Allowlist sumber masih kosong; autopublish tidak bisa diaktifkan.',
  PUBLISH_DRYRUN_REQUIRED:'Jalankan dry-run dulu; arm hanya berlaku untuk rencana yang sudah diuji.',
  PUBLISH_DRYRUN_EXPIRED:'Dry-run sudah kedaluwarsa (10 menit). Jalankan ulang.',
  PUBLISH_PLAN_CHANGED:'Data berubah sejak dry-run. Jalankan dry-run ulang sebelum mengaktifkan.',
  PUBLISH_PLAN_EMPTY:'Tidak ada kandidat yang lolos.',
  PUBLISH_NOT_ARMED:'Autopublish belum diaktifkan.',
  PUBLISH_ARM_EXPIRED:'Izin sudah kedaluwarsa; aktifkan ulang setelah dry-run.',
  PUBLISH_TARGET_NOT_CONFIGURED:'Kredensial tujuan situs belum diisi di backend. Tidak ada data yang dikirim.',
  PUBLISH_TARGET_INVALID:'Alamat tujuan situs tidak valid (harus HTTPS).',
  PUBLISH_APPROVAL_MISSING:'Snapshot persetujuan tidak ditemukan.',
  PUBLISH_CONFIG_INVALID:'Konfigurasi tidak valid.',
  PUBLISH_HTTP_409:'Situs menolak karena konflik data (409).',
};
const msg=(e:unknown)=>MESSAGES[(e as Error)?.message||'']||'Proses publikasi gagal. Tidak ada pengiriman tambahan; periksa audit.';

export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{
    const status=await publishStatus(a.db);
    const plan=status.ready?await buildPlan(a.db):null;
    return reply({status,plan,policy:PUBLISH_POLICY,sources:await (async()=>{try{return (await a.db.execute('SELECT id,name,region,rights_status FROM hub_sources WHERE rights_status=\'permission_confirmed\' ORDER BY name')).rows.map(r=>({id:String(r.id),name:String(r.name),region:String(r.region),rights:String(r.rights_status)}));}catch{return [];}})()});
  }catch{return errorJson('Status autopublish belum dapat dibaca.',503);}
}
export async function POST(request:Request){
  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='webhub')return errorJson('Autopublish dibatasi Preview webhub.',403);
  const actor='owner';
  try{
    const b=await readJson(request);
    if(b.action==='prepare'){if(b.confirm!=='PREPARE AUTOPUBLISH')return errorJson('Konfirmasi diperlukan.',400);return reply(await preparePublishSchema(a.db));}
    if(b.action==='updateConfig'){if(b.confirm!=='UPDATE PUBLISH CONFIG')return errorJson('Konfirmasi diperlukan.',400);return reply(await updateConfig(a.db,b,actor));}
    if(b.action==='dryRun'){if(b.confirm!=='DRY RUN PUBLISH')return errorJson('Konfirmasi diperlukan.',400);return reply(await dryRun(a.db,actor));}
    if(b.action==='arm'){if(b.confirm!=='ARM AUTOPUBLISH')return errorJson('Konfirmasi diperlukan.',400);return reply(await arm(a.db,b.planHash,b.confirm,actor));}
    if(b.action==='disarm'){if(b.confirm!=='DISARM AUTOPUBLISH')return errorJson('Konfirmasi diperlukan.',400);return reply(await disarm(a.db,actor));}
    if(b.action==='publish'){
      if(b.confirm!=='PUBLISH NOW')return errorJson('Konfirmasi diperlukan.',400);
      return reply(await publishArmed(a.db,actor,supabaseDeliver()));
    }
    if(b.action==='config'){return reply(await readConfig(a.db));}
    return errorJson('Aksi tidak dikenal.',400);
  }catch(e){return errorJson(msg(e),409);}
}
