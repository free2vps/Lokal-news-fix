import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {writesAllowed,writeGateMessage} from '@/server/hub/security/write-gate';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {resolveDeliveryTarget} from '@/server/hub/domain/delivery-target';
import {periksaRobots} from '@/lib/pemda/robots';
import {sadurTautan} from '@/lib/pemda/sadur';
import {slugify} from '@/lib/utils';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const reply=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:NO_STORE});

/**
 * Pintu tautan berita pemda.
 *
 * Alur: tempel tautan → periksa robots.txt sumber (DILARANG = berhenti) → sadur ringkasan
 * setia → simpan sebagai DRAF. Tidak ada penerbitan otomatis; pemilik menekan Setujui.
 *
 * Kenapa draf, bukan langsung terbit: isi situs pemda adalah milik mereka. Portal hanya
 * menyajikan ringkasan + atribusi + tautan asli, dan pemilik yang memutuskan kelayakannya.
 */
function db():SupabaseClient{
  const t=resolveDeliveryTarget();
  if(t.source==='none')throw Error('Tujuan terbit (Supabase) belum dikonfigurasi.');
  return createClient(t.url,t.key,{auth:{persistSession:false,autoRefreshToken:false}});
}

export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{
    const {data,error}=await db().from('pemda_draft').select('*').order('dibuat_at',{ascending:false}).limit(60);
    if(error)return errorJson('Draf belum dapat dibaca: '+error.message,409);
    return reply({items:data??[]});
  }catch(e){return errorJson(e instanceof Error?e.message:'Gagal membaca draf',409);}
}

export async function POST(request:Request){
  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(!writesAllowed())return errorJson(writeGateMessage(),403);
  try{
    const b=await readJson(request) as Record<string,unknown>;
    const supabase=db();

    // 1) TEMPEL TAUTAN → DRAF
    if(b.action==='sadur'||b.action===undefined){
      const alamat=String(b.url??'').trim();
      let url:URL;
      try{url=new URL(alamat);}catch{return errorJson('Tempel alamat lengkap (https://…).',400);}
      if(url.protocol!=='https:'||url.username||url.password)return errorJson('Hanya alamat https biasa yang diterima.',400);

      const robots=await periksaRobots(url.href);
      if(!robots.diizinkan)return errorJson(robots.alasan,403);

      const hasil=await sadurTautan(url.href);
      if('kode' in hasil)return errorJson(hasil.pesan,422);

      const {data,error}=await supabase.from('pemda_draft').upsert({
        sumber_url:hasil.sumber_url, judul:hasil.judul, ringkasan:hasil.ringkasan,
        tanggal_sumber:hasil.tanggal?hasil.tanggal.slice(0,10):null,
        gambar_url:hasil.gambar_url, sumber_nama:hasil.sumber_nama,
        status:'draf', dibuat_at:new Date().toISOString(),
      },{onConflict:'sumber_url',ignoreDuplicates:false}).select();
      if(error)return errorJson('Draf gagal disimpan: '+error.message,409);
      return reply({ok:true,robots:robots.alasan,items:data??[]});
    }

    const id=Number(b.id);
    if(!Number.isFinite(id))return errorJson('id draf tidak valid.',400);

    // 2) TOLAK
    if(b.action==='tolak'){
      const {error}=await supabase.from('pemda_draft')
        .update({status:'ditolak',diputuskan_at:new Date().toISOString()}).eq('id',id);
      if(error)return errorJson('Gagal menolak draf: '+error.message,409);
      return reply({ok:true});
    }

    // 3) HAPUS (menghapus catatan draf saja, bukan artikel yang sudah terbit)
    if(b.action==='hapus'){
      const {error}=await supabase.from('pemda_draft').delete().eq('id',id);
      if(error)return errorJson('Gagal menghapus draf: '+error.message,409);
      return reply({ok:true});
    }

    // 4) SETUJUI → jadi artikel di portal
    if(b.action==='setuju'){
      const {data:baris,error:baca}=await supabase.from('pemda_draft').select('*').eq('id',id).maybeSingle();
      if(baca||!baris)return errorJson('Draf tidak ditemukan.',404);
      if(baris.status==='disetujui')return errorJson('Draf ini sudah disetujui.',409);

      const judul=String(b.judul).slice(0,200);
      const slug=`${slugify(judul).slice(0,70)}-pemda-${createHash('sha256').update(String(baris.sumber_url)).digest('hex').slice(0,12)}`;
      const tanda=(baris.tanggal_sumber?Date.parse(String(baris.tanggal_sumber)):NaN);
      const terbit=Number.isFinite(tanda)?new Date(tanda).toISOString():new Date().toISOString();
      const ringkasan=`${baris.ringkasan}\n\nSumber: ${baris.sumber_nama} — ${baris.sumber_url}\nRingkasan dari pengumuman resmi; isi lengkap ada di tautan sumber.`;
      const {data:artikel,error:tulis}=await supabase.from('articles').insert({
        slug, source_url:baris.sumber_url, source_name:baris.sumber_nama,
        original_title:judul, title:judul, ai_summary:ringkasan.slice(0,1000),
        category:'Info Pemda', section:'berita', region:'NTB',
        image_url:baris.gambar_url??null, image_credit:baris.gambar_url?baris.sumber_nama:null,
        published_at:terbit, jenis_sumber:'rilis',
      }).select('id,slug').maybeSingle();
      if(tulis)return errorJson('Artikel gagal dibuat: '+tulis.message,409);

      await supabase.from('pemda_draft')
        .update({status:'disetujui',slug_artikel:artikel?.slug??slug,diputuskan_at:new Date().toISOString()}).eq('id',id);
      return reply({ok:true,slug:artikel?.slug??slug});
    }

    return errorJson('Tindakan tidak dikenal.',400);
  }catch(e){return errorJson(e instanceof Error?e.message:'Gagal memproses tautan pemda',409);}
}
