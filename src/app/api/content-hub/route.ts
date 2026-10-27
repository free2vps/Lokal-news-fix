import { NextRequest, NextResponse } from 'next/server';
import { hubEnabled, readHubCache } from '@/lib/content-hub/cache';
import { array, object, text } from '@/lib/content-hub/mapping';
export const dynamic='force-dynamic';
export async function GET(request: NextRequest) {
 if(!hubEnabled())return NextResponse.json({ok:false,error:'Integrasi Content Hub belum diaktifkan'},{status:503});
 const p=request.nextUrl.searchParams,type=p.get('type')||'recommended';
 if(!['recommended','news','x-trends','youtube-music','all'].includes(type))return NextResponse.json({ok:false,error:'type tidak valid'},{status:400});
 const limit=Number(p.get('limit')||20),offset=Number(p.get('cursor')||0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)return NextResponse.json({ok:false,error:'Pagination tidak valid'},{status:400});
 try{
  const cache=await readHubCache(),recommended=object(cache.recommended?.payload);
  if(type==='recommended'&&!recommended)return NextResponse.json({ok:false,error:'Jalankan impor Content Hub terlebih dahulu'},{status:503});
  const fresh=(v:unknown)=>{const row=object(v);const t=Date.parse(text(row?.published_at||row?.video_published_at));return Number.isFinite(t)&&Date.now()-t<=72*3600000&&t<=Date.now()+300000;};
  const candidates=array(recommended?.items).filter(fresh);
  let selected=candidates;
  if(type==='news')selected=selected.filter(v=>object(v)?.kind==='article');
  if(p.get('category'))selected=selected.filter(v=>object(v)?.editorial_category===p.get('category'));
  if(p.get('region'))selected=selected.filter(v=>object(v)?.region===p.get('region'));
  if(p.get('since')){const since=Date.parse(p.get('since')!);if(!Number.isFinite(since))return NextResponse.json({ok:false,error:'since tidak valid'},{status:400});selected=selected.filter(v=>Date.parse(text(object(v)?.published_at))>=since);}
  const items=selected.slice(offset,offset+limit);
  const pagination={limit,nextCursor:offset+limit<selected.length?String(offset+limit):null};
  const common={ok:true,generatedAt:new Date().toISOString(),storage:'supabase',importedAt:Object.fromEntries(Object.entries(cache).map(([key,row])=>[key,row.importedAt])),cacheStatus:Object.fromEntries(Object.entries(cache).map(([key,row])=>[key,Date.now()-Date.parse(row.importedAt)>7200000?'stale':'cached']))};
  if(type==='recommended'){
   const news=items.filter(v=>object(v)?.contentGroup==='news').length;
   return NextResponse.json({...common,items,policy:{...(object(recommended?.policy)||{}),actual:{news,entertainment:items.length-news},ratioSatisfied:news===Math.round(items.length*.6)},pagination});
  }
  const result:Record<string,unknown>={};
  if(type==='all'||type==='news')result.news=(type==='news'?items:candidates.filter(v=>object(v)?.kind==='article').slice(0,limit));
  if(type==='all'||type==='x-trends')result.xTrends=cache['x-trends']?.payload||null;
  if(type==='all'||type==='youtube-music')result.youtubeMusic=cache['youtube-music']?.payload||[];
  return NextResponse.json({...common,data:result,pagination:type==='news'?pagination:null});
 }catch{return NextResponse.json({ok:false,error:'Snapshot belum tersedia; periksa migrasi dan konfigurasi database'},{status:503});}
}
