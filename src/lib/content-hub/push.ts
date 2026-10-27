import { createHmac, timingSafeEqual } from 'crypto';
import { object } from './mapping';
export const PUSH_MAX_BYTES=3_000_000;
export function verifyPush(raw:string,timestamp:string|null,signature:string|null,secret:string,now=Date.now()){
 if(secret.length<32||!timestamp||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300_000||!signature||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const expected='sha256='+createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
 return timingSafeEqual(Buffer.from(expected),Buffer.from(signature));
}
export function pushLoader(raw:string){
 const body=object(JSON.parse(raw));if(body?.version!==1)throw Error('Versi payload tidak valid');
 const feeds=object(body.feeds);if(!feeds)throw Error('feeds tidak valid');
 for(const type of ['recommended','x-trends','youtube-music']){
  const p=object(feeds[type]);if(!p?.ok)throw Error('Feed tidak valid: '+type);
  if(type==='recommended'&&(!Array.isArray(p.items)||p.items.length>100))throw Error('Batas kandidat tidak valid');
  if(type!=='recommended'&&!object(p.data))throw Error('Data feed tidak valid');
 }
 return async(type:string)=>object(feeds[type])!;
}
