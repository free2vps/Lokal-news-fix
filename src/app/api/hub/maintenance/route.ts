import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {migrationStatus,prepareOperationalSchema} from '@/server/hub/domain/maintenance';
import {prepareFeatures} from '@/server/hub/domain/operations';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){const a=await authenticatedDb(request);if(a.error)return a.error;try{return NextResponse.json(await migrationStatus(a.db),{headers:NO_STORE});}catch{return errorJson('Status skema belum tersedia.',503);}}
export async function POST(request:Request){
 const rejected=invalidMutation(request);if(rejected)return rejected;
 const a=await authenticatedDb(request);if(a.error)return a.error;
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='webhub')return errorJson('Hanya Preview webhub.',403);
 try{const b=await readJson(request);if(b.confirm!=='PREPARE PREVIEW')return errorJson('Konfirmasi diperlukan.',400);const result=await prepareOperationalSchema(a.db);await prepareFeatures(a.db,process.env.HUB_MIGRATION_MASTER_KEY||process.env.HUB_MASTER_KEY);return NextResponse.json({...result,featuresReady:true},{headers:NO_STORE});}
 catch{return errorJson('Skema belum siap atau ada konflik data. Tidak ada penghapusan; transaksi dibatalkan.',409);}
}
