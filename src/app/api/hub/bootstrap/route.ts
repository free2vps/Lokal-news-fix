import {NextResponse} from 'next/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(){return NextResponse.json({ok:false,error:'Bootstrap ditutup pada versi pascamigrasi ini.'},{status:410,headers:{'Cache-Control':'no-store'}});}
