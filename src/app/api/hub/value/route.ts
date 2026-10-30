import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {prepareValues,valueBatch,valueStatus,getValue,listValues,VALUE_POLICY} from '@/server/hub/domain/editorial-value';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^(?:legacy-news:)?[0-9a-f-]{36}$/.test(v);
const reply=(value:unknown)=>NextResponse.json(value,{headers:NO_STORE});

export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{
    const url=new URL(request.url);const status=await valueStatus(a.db);
    const id=url.searchParams.get('id');if(id){if(!validId(id))return errorJson('ID berita tidak valid.',400);if(!status.ready)return errorJson('Siapkan tabel nilai editorial dahulu.',409);return reply({item:await getValue(a.db,id)});}
    const tier=url.searchParams.get('tier')||undefined;
    return reply({status,policy:VALUE_POLICY,items:status.ready?await listValues(a.db,50,tier):[],publicationEnabled:false});
  }catch{return errorJson('Nilai editorial belum dapat dibaca. Isi berita tidak diubah.',503);}
}
export async function POST(request:Request){
  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='webhub')return errorJson('Penilaian editorial dibatasi Preview webhub.',403);
  try{
    const b=await readJson(request);
    if(b.action==='prepare'){if(b.confirm!=='PREPARE VALUES')return errorJson('Konfirmasi diperlukan.',400);return reply(await prepareValues(a.db));}
    if(b.action==='batch'){
      if(b.id!==undefined&&!validId(b.id))return errorJson('ID berita tidak valid.',400);
      if(b.cursor!==undefined&&b.cursor!==''&&!validId(b.cursor))return errorJson('Cursor tidak valid.',400);
      if(!(await valueStatus(a.db)).ready)return errorJson('Siapkan tabel nilai editorial dahulu.',409);
      return reply(await valueBatch(a.db,typeof b.cursor==='string'?b.cursor:'',typeof b.id==='string'?b.id:undefined));
    }
    return errorJson('Aksi tidak dikenal.',400);
  }catch{return errorJson('Penilaian editorial gagal. Batch dibatalkan; isi, edit dan persetujuan berita tidak diubah.',409);}
}
