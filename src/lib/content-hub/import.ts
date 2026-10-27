import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '../supabase';
import { mapHubArticle, object, array } from './mapping';
export { mapHubArticle } from './mapping';

async function fetchHub(type:string){
 const base=process.env.PORTAL_HUB_URL,token=process.env.PORTAL_API_TOKEN;
 if(!base||!token)throw new Error('Konfigurasi Content Hub belum lengkap');
 const url=new URL('/api/portal-feed',base);url.searchParams.set('type',type);url.searchParams.set('limit','100');
 const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`Content Hub ${type} HTTP ${response.status}`);
 const raw=await response.text();if(raw.length>3000000)throw new Error('Respons Content Hub terlalu besar');
 const data=object(JSON.parse(raw));if(!data?.ok)throw new Error('Respons Content Hub tidak valid');return data;
}
export async function importContentHub(options:{articles?:boolean}={},deps:{db?:ReturnType<typeof supabaseAdmin>;load?:typeof fetchHub;changed?:()=>void}={}){
 const db=deps.db||supabaseAdmin(),load=deps.load||fetchHub,owner=randomUUID();const stats={mode:'content-hub',sources:0,found:0,inserted:0,skipped:0,snapshots:[] as string[],errors:[] as string[]};
 const {data:locked,error:lockError}=await db.rpc('acquire_content_hub_lease',{lease_owner:owner});
 if(lockError)throw new Error('Lock database belum tersedia; jalankan migrasi Content Hub');
 if(!locked)return {...stats,skipped:1,note:'Impor lain masih berjalan'};
 const store=async(key:string,payload:unknown)=>{const {error}=await db.from('content_hub_cache').upsert({key,payload,imported_at:new Date().toISOString()},{onConflict:'key'});if(error)throw new Error('Penyimpanan snapshot gagal');stats.snapshots.push(key);};
 try{
   // Isolate failures. No fallback to paid AI or external scraping from Vercel.
   if(options.articles!==false)try{
     const payload=await load('recommended');if(!Array.isArray(payload.items))throw new Error('items rekomendasi tidak valid');
     stats.found=payload.items.length;
     const mapped=array(payload.items).map(item=>mapHubArticle(item)).filter((v):v is NonNullable<typeof v>=>!!v);
     const rows=[...new Map(mapped.map(row=>[row.source_url,row])).values()];
     if(rows.length){const {data,error}=await db.from('articles').upsert(rows,{onConflict:'source_url',ignoreDuplicates:true}).select('id');if(error)throw new Error('Impor artikel gagal; periksa schema articles/source_id dan unique source_url');stats.inserted=data?.length??0;stats.skipped=rows.length-stats.inserted;}
     // Empty successful payload does not erase last useful snapshot.
     if(payload.items.length)await store('recommended',payload);
   }catch(e){stats.errors.push((e as Error).message);}
   try{const p=await load('x-trends');const value=object(object(p.data)?.xTrends);if(value&&array(value.items).length&&object(value.lastValidSnapshot))await store('x-trends',value);else stats.errors.push('Snapshot X valid tidak tersedia; snapshot lama dipertahankan');}catch(e){stats.errors.push((e as Error).message);}
   try{const p=await load('youtube-music');const value=object(p.data)?.youtubeMusic;if(Array.isArray(value)&&value.length)await store('youtube-music',value);else stats.errors.push('Item YouTube tidak tersedia; snapshot lama dipertahankan');}catch(e){stats.errors.push((e as Error).message);}
   if(stats.inserted||stats.snapshots.length){if(deps.changed)deps.changed();else{revalidatePath('/');revalidatePath('/sitemap.xml');}}
   return stats;
 }finally{await db.rpc('release_content_hub_lease',{lease_owner:owner});}
}
