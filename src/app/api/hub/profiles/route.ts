import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {prepareProfiles,profileStatus,profileBatch,getProfile} from '@/server/hub/domain/content-profile';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^(?:legacy-news:)?[0-9a-f-]{36}$/.test(v);
function reply(value:unknown){return NextResponse.json(value,{headers:NO_STORE});}
export async function GET(request:Request){const a=await authenticatedDb(request);if(a.error)return a.error;try{const status=await profileStatus(a.db);const id=new URL(request.url).searchParams.get('id');if(!id)return reply(status);if(!validId(id))return errorJson('ID berita tidak valid.',400);if(!status.ready)return errorJson('Siapkan tabel profil dahulu.',409);return reply({profile:await getProfile(a.db,id)});}catch{return errorJson('Profil belum dapat dibaca. Isi berita tidak diubah.',503);}}
export async function POST(request:Request){
 const invalid=invalidMutation(request);if(invalid)return invalid;
 const a=await authenticatedDb(request);if(a.error)return a.error;
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='webhub')return errorJson('Profil dibatasi Preview webhub.',403);
 try{const b=await readJson(request);
  if(b.action==='prepare'){if(b.confirm!=='PREPARE PROFILES')return errorJson('Konfirmasi diperlukan.',400);return reply(await prepareProfiles(a.db));}
  if(b.action==='batch'){
   if(b.id!==undefined&&!validId(b.id))return errorJson('ID berita tidak valid.',400);
   if(b.cursor!==undefined&&b.cursor!==''&&!validId(b.cursor))return errorJson('Cursor tidak valid.',400);
   if(!(await profileStatus(a.db)).ready)return errorJson('Siapkan tabel profil dahulu.',409);
   return reply(await profileBatch(a.db,typeof b.cursor==='string'?b.cursor:'',typeof b.id==='string'?b.id:undefined));
  }
  return errorJson('Aksi tidak dikenal.',400);
 }catch{return errorJson('Pembuatan profil gagal. Batch dibatalkan; isi, edit dan persetujuan berita tidak diubah.',409);}
}
