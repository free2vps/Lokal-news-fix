import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {getPreferences,savePreferences,retentionPreview,logs} from '@/server/hub/domain/operations';
import {getX,getYoutube,syncX,syncYoutube} from '@/server/hub/domain/social';
import {recommendations} from '@/server/hub/domain/recommendations';
import {verifyRss,setRssActive,syncRss,toggleSource} from '@/server/hub/domain/rss-runtime';
import {changeOwnerPassword} from '@/server/hub/security/auth';
import {accessStatus,workspaceFailure} from '@/server/hub/domain/access-status';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
function reply(value:unknown){return NextResponse.json(value,{headers:NO_STORE});}
export async function GET(request:Request){
 const a=await authenticatedDb(request);if(a.error)return a.error;
 const master=process.env.HUB_MIGRATION_MASTER_KEY||process.env.HUB_MASTER_KEY;
 try{switch(new URL(request.url).searchParams.get('kind')){
  case 'access':return reply(await accessStatus(a.db));
  case 'x':return reply(await getX(a.db,master));
  case 'youtube':return reply(await getYoutube(a.db,master));
  case 'logs':return reply(await logs(a.db,master));
  case 'recommendations':return reply(await recommendations(a.db,(await getPreferences(a.db)).freshnessHours));
  case 'settings':{const preferences=await getPreferences(a.db);return reply({preferences,retention:await retentionPreview(a.db,preferences.retentionDays),schedulerEnabled:false});}
  case 'integration':return reply({publicationEnabled:false,workerInstalled:false,outbox:(await a.db.execute('SELECT status,count(*) total FROM hub_publish_outbox GROUP BY status')).rows,approved:Number((await a.db.execute("SELECT count(*) n FROM hub_items WHERE review_state='approved'")).rows[0].n),note:'No delivery to Supabase or social platforms is enabled.'});
  default:return errorJson('Menu tidak dikenal.',400);
 }}catch{return errorJson('Data belum dapat dibaca. Siapkan skema dan periksa master arsip; data lama tidak dihapus.',409);}
}
export async function POST(request:Request){
 const invalid=invalidMutation(request);if(invalid)return invalid;
 const a=await authenticatedDb(request);if(a.error)return a.error;
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='webhub')return errorJson('Perubahan dibatasi Preview webhub.',403);
 try{const b=await readJson(request);
  if(b.action==='settings'){
   if(!b.preferences||typeof b.preferences!=='object'||Array.isArray(b.preferences))return errorJson('Pengaturan tidak valid.',400);
   return reply({preferences:await savePreferences(a.db,b.preferences as Record<string,unknown>)});
  }
  if(b.action==='password'){
   const result=await changeOwnerPassword(a.db,b.currentPassword,b.newPassword);
   return result?reply({ok:true,signInAgain:true}):errorJson('Password saat ini salah, password baru tidak valid, atau batas percobaan tercapai.',400);
  }
  const preferences=await getPreferences(a.db);
  if(b.action==='syncX'){if(preferences.allowX!==true)throw Error('ACCESS_NOT_CONFIRMED');return reply(await syncX(a.db));}
  if(b.action==='syncYoutube'){if(preferences.allowYoutube!==true)throw Error('ACCESS_NOT_CONFIRMED');return reply(await syncYoutube(a.db));}
  // Satu saklar RSS Manager: tidak butuh token konfirmasi, tidak butuh saklar izin terpisah.
  if(b.action==='toggleSource'){
   if(typeof b.sourceId!=='string'||b.sourceId.length>200)return errorJson('ID sumber tidak valid.',400);
   if(typeof b.active!=='boolean')return errorJson('Status aktif tidak valid.',400);
   if(b.active&&preferences.allowRss!==true)await savePreferences(a.db,{...preferences,allowRss:true});
   return reply(await toggleSource(a.db,b.sourceId,b.active));
  }
  if(['verifyRss','syncRss','enableRss','disableRss'].includes(String(b.action))){
   if(typeof b.sourceId!=='string'||b.sourceId.length>200)return errorJson('ID sumber tidak valid.',400);
   if(b.action==='disableRss')return reply(await setRssActive(a.db,b.sourceId,false));
   if(!preferences.allowRss||b.confirmRights!==true)throw Error('ACCESS_NOT_CONFIRMED');
   if(b.action==='verifyRss')return reply(await verifyRss(a.db,b.sourceId));
   if(b.action==='enableRss')return reply(await setRssActive(a.db,b.sourceId,true));
   return reply(await syncRss(a.db,b.sourceId));
  }
  return errorJson('Aksi tidak dikenal.',400);
 }catch(e){const code=e instanceof Error?e.message:'';
  return NextResponse.json(workspaceFailure(code),{status:409,headers:NO_STORE});
 }
}
