import { NextResponse } from 'next/server';
import { importContentHub } from '@/lib/content-hub/import';
import { PUSH_MAX_BYTES, verifyPush, pushLoader } from '@/lib/content-hub/push';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(req:Request){
 if(process.env.CONTENT_HUB_ENABLED!=='true'||process.env.CONTENT_HUB_TRANSPORT!=='push')return NextResponse.json({ok:false,error:'Mode push belum aktif'},{status:503});
 const secret=process.env.CONTENT_HUB_PUSH_SECRET;
 if(!secret||secret.length<32)return NextResponse.json({ok:false,error:'Konfigurasi push belum lengkap'},{status:503});
 const reader=req.body?.getReader();if(!reader)return NextResponse.json({ok:false,error:'Payload kosong'},{status:400});
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>PUSH_MAX_BYTES){await reader.cancel();return NextResponse.json({ok:false,error:'Payload terlalu besar'},{status:413});}chunks.push(value);}
 const raw=Buffer.concat(chunks).toString('utf8');
 if(!verifyPush(raw,req.headers.get('x-hub-timestamp'),req.headers.get('x-hub-signature'),secret))return NextResponse.json({ok:false,error:'Autentikasi push gagal'},{status:401});
 let load;try{load=pushLoader(raw);}catch{return NextResponse.json({ok:false,error:'Payload tidak valid'},{status:400});}
 try{const result=await importContentHub({},{load});return NextResponse.json({ok:!result.errors.length,...result},{status:result.errors.length?207:200});}catch{return NextResponse.json({ok:false,error:'Impor push gagal; data lama dipertahankan'},{status:502});}
}
