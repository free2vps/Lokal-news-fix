import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {suggestSummary} from '@/server/hub/domain/ai-runtime';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request:Request){
 const rejected=invalidMutation(request);if(rejected)return rejected;
 const a=await authenticatedDb(request);if(a.error)return a.error;
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='webhub')return errorJson('AI ini dibatasi Preview webhub.',403);
 try{
  const b=await readJson(request);
  if(typeof b.id!=='string'||!/^(?:legacy-news:)?[0-9a-f-]{36}$/.test(b.id)||!Number.isInteger(b.version)||Number(b.version)<1)return errorJson('ID/versi tidak valid.',400);
  return NextResponse.json({ok:true,...await suggestSummary(a.db,b.id,Number(b.version),process.env.HUB_MASTER_KEY)},{headers:NO_STORE});
 }catch(e){const code=e instanceof Error?e.message:'';
 const messages:Record<string,string>={AI_NTB_ONLY:'AI hanya untuk berita NTB.',AI_CONSENT_REQUIRED:'Konfirmasikan pengiriman judul/cuplikannya di Pengaturan AI.',AI_PROVIDER_NOT_READY:'Provider gratis belum siap.',VERSION_CONFLICT:'Versi berubah. Muat ulang.',AI_LIMIT_OR_BUSY:'Batas 20 percobaan/hari tercapai atau ada proses aktif.'};
 return errorJson(messages[code]||'AI belum siap. Periksa skema, master key dan konfigurasi. Teks asli tetap disimpan.',409);}
}
