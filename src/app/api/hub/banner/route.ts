import {NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {writesAllowed,writeGateMessage} from '@/server/hub/security/write-gate';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {resolveDeliveryTarget} from '@/server/hub/domain/delivery-target';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
const reply=(v:unknown)=>NextResponse.json(v,{headers:NO_STORE});

/**
 * Banner / pengumuman pemda — satu slot tetap di beranda (pilihan pemilik: A).
 *
 * Kenapa lewat route ini dan bukan langsung dari browser: kunci Supabase adalah rahasia
 * backend. Browser hanya mengirim isi banner; backend yang menulis memakai service role.
 * Isi TIDAK dikarang — semua kolom diisi pemilik. Gambar hanya disimpan sebagai alamat,
 * berkasnya tidak disalin ke server portal (tidak menambah kuota).
 */
function db(){
  const t=resolveDeliveryTarget();
  if(t.source==='none')throw Error('Banner belum tersambung: tujuan terbit (Supabase) belum dikonfigurasi.');
  return createClient(t.url,t.key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function https(value:unknown,field:string){
  const teks=String(value??'').trim();
  if(!teks)return null;
  let u:URL;try{u=new URL(teks);}catch{throw Error(`${field} harus berupa alamat lengkap (https://…)`);}
  if(u.protocol!=='https:')throw Error(`${field} wajib memakai https`);
  return u.href;
}

export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{
    const {data,error}=await db().from('banner_pemda').select('*').order('urutan',{ascending:true}).order('created_at',{ascending:false});
    if(error)return errorJson('Banner belum dapat dibaca: '+error.message,409);
    return reply({items:data??[]});
  }catch(e){return errorJson(e instanceof Error?e.message:'Gagal membaca banner',409);}
}

export async function POST(request:Request){
  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(!writesAllowed())return errorJson(writeGateMessage(),403);
  try{
    const b=await readJson(request) as Record<string,unknown>;
    const supabase=db();
    if(b.action==='delete'){
      const id=Number(b.id);
      if(!Number.isFinite(id))return errorJson('id banner tidak valid.',400);
      const {error}=await supabase.from('banner_pemda').delete().eq('id',id);
      if(error)return errorJson('Banner gagal dihapus: '+error.message,409);
      return reply({ok:true,deleted:id});
    }
    const judul=String(b.judul??'').trim();
    if(!judul)return errorJson('Judul banner wajib diisi.',400);
    const gambar=https(b.gambar_url,'Alamat gambar');
    if(!gambar)return errorJson('Alamat gambar wajib diisi.',400);
    const row={
      judul:judul.slice(0,160), gambar_url:gambar, tautan:https(b.tautan,'Alamat tujuan'),
      aktif:b.aktif!==false, mulai:(b.mulai?String(b.mulai):null), selesai:(b.selesai?String(b.selesai):null),
      urutan:Number.isFinite(Number(b.urutan))?Math.trunc(Number(b.urutan)):0,
    };
    const id=Number(b.id);
    const ubah=Number.isFinite(id)&&id>0;
    const {data,error}=ubah
      ? await supabase.from('banner_pemda').update(row).eq('id',id).select()
      : await supabase.from('banner_pemda').insert(row).select();
    if(error)return errorJson('Banner gagal disimpan: '+error.message,409);
    return reply({ok:true,items:data??[]});
  }catch(e){return errorJson(e instanceof Error?e.message:'Gagal menyimpan banner',409);}
}
