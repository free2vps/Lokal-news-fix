import type {Client} from '@libsql/client';
import {createDecipheriv,createHash} from 'node:crypto';
const ALLOWED=new Set(['x_trend_items','x_trend_snapshots','youtube_music_items','sync_runs','app_settings']);
const cache=new Map<string,{hash:string;rows:Record<string,unknown>[]}>();
/** Explicit table allowlist; never decrypt credentials/sessions/provider keys in data-view APIs. */
export async function readArchive(db:Client,table:string,encoded:string|undefined){
 if(!ALLOWED.has(table))throw Error('ARCHIVE_NOT_ALLOWED');
 if(!encoded)throw Error('ARCHIVE_MASTER_REQUIRED');
 const key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw Error('ARCHIVE_MASTER_REQUIRED');
 const row=(await db.execute({sql:'SELECT row_count,ciphertext FROM hub_legacy_archive_v1 WHERE table_name=?',args:[table]})).rows[0];
 if(!row)return [];
 const text=String(row.ciphertext);if(text.length>24000000)throw Error('ARCHIVE_TOO_LARGE');
 const hash=createHash('sha256').update(text).update(String(row.row_count)).update(key).digest('hex');
 if(cache.get(table)?.hash===hash)return cache.get(table)!.rows;
 const [v,iv,tag,body]=text.split(':');if(v!=='v1')throw Error('ARCHIVE_INVALID');
 const d=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAAD(Buffer.from('hub-migration:v1:'+table));d.setAuthTag(Buffer.from(tag,'base64'));
 const rows=JSON.parse(Buffer.concat([d.update(Buffer.from(body,'base64')),d.final()]).toString('utf8'));
 if(!Array.isArray(rows)||rows.length!==Number(row.row_count)||rows.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('ARCHIVE_INVALID');
 cache.set(table,{hash,rows});return rows as Record<string,unknown>[];
}
