import {writesAllowed,writeGateMessage} from '@/server/hub/security/write-gate';
import {NextResponse} from 'next/server';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {getHubDb} from '@/server/hub/db/client';
import {prepareSocialSchema,claimBatch,acknowledge,socialStatus,enqueuePublished,issueSocialToken,revokeSocialToken,requeueFailed,verifySocialToken,SOCIAL_POLICY} from '@/server/hub/domain/social-pull';
import {getGoogle,getX} from '@/server/hub/domain/social';
import {susunHashtag,barisTag} from '@/lib/hashtag';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const reply=(value:unknown)=>NextResponse.json(value,{headers:NO_STORE});
const MESSAGES:Record<string,string>={
  SOCIAL_NOT_READY:'Siapkan tabel antrean media sosial dahulu.',
  SOCIAL_TOKEN_INVALID:'Token tidak valid atau sudah dicabut.',
  SOCIAL_ACK_INVALID:'Ack tidak valid (deliveryKey 32 hex, maksimum 10 item).',
};
const msg=(e:unknown)=>MESSAGES[(e as Error)?.message||'']||'Permintaan media sosial gagal.';

/**
 * Tambahkan hashtag pada setiap item yang akan diposting Make.
 *
 * Dua lapis, sesuai keputusan pemilik:
 *  - tag dari isi berita sendiri (wilayah, kategori, tag) — selalu ada;
 *  - satu tag tren (Google Trends / tren X) — HANYA bila kata terpenting tren itu benar-benar
 *    muncul di judul atau ringkasan berita. Menempelkan tren yang tidak nyambung itu spam.
 *
 * Tren dibaca sekali per permintaan dan tidak boleh menggagalkan pengiriman: bila data tren
 * sedang tidak tersedia, kiriman tetap jalan dengan tag dari isi berita saja.
 */
async function denganHashtag(db:ReturnType<typeof getHubDb>, hasil:{items?: unknown[];[k:string]:unknown}) {
  let tren:string[]=[];
  try{
    const [g,x]=await Promise.all([
      getGoogle(db as never).catch(()=>({items:[] as {text:string}[]})),
      getX(db as never,undefined).catch(()=>({items:[] as {text:string}[]})),
    ]);
    const teks=(v:unknown)=>Array.isArray((v as {items?:{text?:string}[]})?.items)
      ? (v as {items:{text?:string}[]}).items.map(i=>String(i?.text||'').trim()).filter(Boolean) : [];
    // Google lebih dulu (sumber resmi gratis), lalu tren X.
    tren=[...teks(g),...teks(x)];
  }catch{tren=[];}
  const items=(Array.isArray(hasil.items)?hasil.items:[]) as Record<string,unknown>[];
  return {...hasil, trenDigunakan: tren.length, items: items.map(i=>{
    const hashtags=susunHashtag({
      judul:String(i.title||''), ringkasan:String(i.summary||''), wilayah:(i.region as string|null)??null,
      kategori:(i.category as string|null)??null, tag:Array.isArray(i.tags)?(i.tags as string[]):[],
    },tren);
    const tagLine=barisTag(hashtags);
    return {...i, hashtags, tagLine,
      // caption siap pakai: Make cukup memetakan satu kolom ini ke isi postingan.
      caption:[String(i.title||''),String(i.summary||''),tagLine].filter(Boolean).join('\n\n')};
  })};
}

export async function GET(request:Request){
  const url=new URL(request.url);
  // Make.com menarik antrean dengan GET + bearer token. Tanpa cabang ini, permintaan
  // Make jatuh ke pemeriksaan sesi dan ditolak 401 "masuk sebagai administrator".
  if(url.searchParams.get('action')==='pull'&&request.headers.get('authorization'))return bearerPull(request,url);
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{return reply({...await socialStatus(a.db),policy:{...SOCIAL_POLICY}});}catch{return errorJson('Status antrean sosial belum dapat dibaca.',503);}
}

/** Jalur tanpa sesi: hanya untuk Make, diverifikasi dengan token yang bisa dicabut. */
async function bearerPull(request:Request,url:URL){
  try{
    const db=getHubDb();
    if(!writesAllowed())return errorJson('Penarikan media sosial dibatasi Preview webhub.',403);
    if(!(await verifySocialToken(db,request.headers.get('authorization'))))return errorJson('Token tidak valid atau sudah dicabut.',401);
    const cap=Number(url.searchParams.get('cap'))||undefined;
    const out=await claimBatch(db,{max:Number(url.searchParams.get('max'))||undefined,label:'make',cap});
    return reply(await denganHashtag(db,out));
  }catch(e){return errorJson(msg(e),409);}
}
export async function POST(request:Request){
  const url=new URL(request.url);const action=url.searchParams.get('action');
  const previewOk=writesAllowed();

  // Make.com: pull & ack memakai bearer token, tanpa sesi/CSRF.
  if(action==='pull'&&request.headers.get('authorization'))return bearerPull(request,url);
  if(action==='ack'&&request.headers.get('authorization')){
    try{
      const db=getHubDb();
      if(!previewOk)return errorJson('Penarikan media sosial dibatasi Preview webhub.',403);
      if(!(await verifySocialToken(db,request.headers.get('authorization'))))return errorJson('Token tidak valid atau sudah dicabut.',401);
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
    if(b.action==='previewPull'){if(b.confirm!=='PREVIEW PULL')return errorJson('Konfirmasi diperlukan.',400);const out=await claimBatch(a.db,{max:4,label:'panel-preview'});
    const diperkaya=await denganHashtag(a.db,out as unknown as {items?: unknown[]});
    await acknowledge(a.db,out.items.map(i=>({deliveryKey:i.deliveryKey,ok:false,error:'PANEL_PREVIEW'})),'panel-preview');
    return reply({...diperkaya,note:'Pratinjau tidak mengirim apa pun; item dikembalikan ke antrean sebagai failed untuk dicoba ulang.'});}
    return errorJson('Aksi tidak dikenal.',400);
  }catch(e){return errorJson(msg(e),409);}
}
