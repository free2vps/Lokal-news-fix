import type {Client} from '@libsql/client';
import {randomUUID} from 'node:crypto';
import {readArchive} from './archive';
export const PLAYLIST='OLT0p76Cd7kYMmbBNlt_TvC4vzjFTMKMNjw';
export type Preferences={freshnessHours:number;retentionDays:number;allowX:boolean;allowYoutube:boolean;allowRss:boolean};
export const defaults:Preferences={freshnessHours:72,retentionDays:30,allowX:false,allowYoutube:false,allowRss:false};
export async function prepareFeatures(db:Client,master?:string){
 let initial={...defaults};
 try{const old=await readArchive(db,'app_settings',master);const values=new Map(old.map(r=>[String(r.key),Number(r.value)]));const fresh=values.get('default_freshness_hours'),retention=values.get('news_retention_days');if(Number.isInteger(fresh)&&fresh!>=1&&fresh!<=168)initial.freshnessHours=fresh!;if(Number.isInteger(retention)&&retention!>=7&&retention!<=365)initial.retentionDays=retention!;}catch{/* Defaults are explicit; never reactivate old schedulers/API flags. */}

 const tx=await db.transaction('write');try{
  await tx.execute('CREATE TABLE IF NOT EXISTS hub_preferences_v3 (id TEXT PRIMARY KEY,body TEXT NOT NULL)');
  await tx.execute({sql:"INSERT OR IGNORE INTO hub_preferences_v3 VALUES('owner',?)",args:[JSON.stringify(initial)]});
  await tx.execute('CREATE TABLE IF NOT EXISTS hub_datasets_v3 (kind TEXT PRIMARY KEY,body TEXT NOT NULL,observed_at TEXT NOT NULL)');
  await tx.execute('CREATE TABLE IF NOT EXISTS hub_jobs_v3 (job TEXT PRIMARY KEY,lease_until INTEGER NOT NULL DEFAULT 0,cooldown_until INTEGER NOT NULL DEFAULT 0)');
  await tx.execute('CREATE TABLE IF NOT EXISTS hub_logs_v3 (id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,item_count INTEGER NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,message TEXT NOT NULL)');
  await tx.commit();
 }catch(e){await tx.rollback();throw e;}
}
export async function getPreferences(db:Client):Promise<Preferences>{const r=(await db.execute("SELECT body FROM hub_preferences_v3 WHERE id='owner'")).rows[0];return {...defaults,...JSON.parse(String(r?.body||'{}'))};}
export async function savePreferences(db:Client,input:Record<string,unknown>){
 if(Object.keys(input).some(k=>!['freshnessHours','retentionDays','allowX','allowYoutube','allowRss'].includes(k)))throw Error('PREFERENCE_INVALID');
 for(const k of ['allowX','allowYoutube','allowRss'])if(typeof input[k]!=='boolean')throw Error('PREFERENCE_INVALID');
 if(!Number.isInteger(input.freshnessHours)||Number(input.freshnessHours)<1||Number(input.freshnessHours)>168||!Number.isInteger(input.retentionDays)||Number(input.retentionDays)<7||Number(input.retentionDays)>365)throw Error('PREFERENCE_INVALID');
 await db.execute({sql:"UPDATE hub_preferences_v3 SET body=? WHERE id='owner'",args:[JSON.stringify(input)]});return getPreferences(db);
}
export async function retentionPreview(db:Client,days:number){const cutoff=new Date(Date.now()-days*86400000).toISOString();return {cutoff,days,action:'simulation_only',deleted:0,count:Number((await db.execute({sql:"SELECT count(*) n FROM hub_items WHERE review_state='rejected' AND editorial_title IS NULL AND editorial_summary IS NULL AND editorial_category IS NULL AND julianday(last_seen_at)<julianday(?) AND id NOT IN(SELECT item_id FROM hub_item_approvals) AND id NOT IN(SELECT item_id FROM hub_publish_outbox)",args:[cutoff]})).rows[0].n)};}
export async function dataset(db:Client,kind:string){const r=(await db.execute({sql:'SELECT body FROM hub_datasets_v3 WHERE kind=?',args:[kind]})).rows[0];return r?JSON.parse(String(r.body)):null;}
export async function storeDataset(db:Client,kind:string,value:unknown){await db.execute({sql:'INSERT INTO hub_datasets_v3 VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at',args:[kind,JSON.stringify(value),new Date().toISOString()]});}
export async function runJob<T>(db:Client,kind:string,work:()=>Promise<{value:T;count:number;status?:string}>){
 const now=Date.now(),tx=await db.transaction('write'),id=randomUUID(),lease=now+120000;
 try{
  await tx.execute({sql:'INSERT OR IGNORE INTO hub_jobs_v3(job) VALUES(?)',args:[kind]});
  const r=await tx.execute({sql:'UPDATE hub_jobs_v3 SET lease_until=?,cooldown_until=? WHERE job=? AND lease_until<? AND cooldown_until<?',args:[lease,now+120000,kind,now,now]});
  if(!r.rowsAffected)throw Error('JOB_COOLDOWN');
  await tx.execute({sql:"INSERT INTO hub_logs_v3 VALUES(?,?,'RUNNING',0,?,NULL,'Manual sync started')",args:[id,kind,new Date(now).toISOString()]});await tx.commit();
 }catch(e){await tx.rollback();throw e;}
 try{const result=await work();await db.execute({sql:'UPDATE hub_logs_v3 SET status=?,item_count=?,finished_at=?,message=? WHERE id=?',args:[result.status||'SUCCESS',result.count,new Date().toISOString(),'Manual sync completed',id]});return result.value;}
 catch(e){const code=e instanceof Error?e.message:'';const safe=/^(HTTP_\d{3}|ROBOTS_UNAVAILABLE|ROBOTS_BLOCKED|NETWORK_BLOCKED|NETWORK_TIMEOUT|RESPONSE_TOO_LARGE|X_ONE_HOUR_UNAVAILABLE|PLAYLIST_UNAVAILABLE|RSS_INVALID|SOURCE_NOT_READY)$/.test(code)?code:'SYNC_FAILED';await db.execute({sql:"UPDATE hub_logs_v3 SET status='ERROR',finished_at=?,message=? WHERE id=?",args:[new Date().toISOString(),safe,id]});throw Error(safe);}
 finally{await db.execute({sql:'UPDATE hub_jobs_v3 SET lease_until=0 WHERE job=? AND lease_until=?',args:[kind,lease]});}
}
export async function logs(db:Client,master:string|undefined){
 const current=(await db.execute('SELECT id,kind,status,item_count,started_at,finished_at,message FROM hub_logs_v3 ORDER BY started_at DESC LIMIT 100')).rows;
 let history:Record<string,unknown>[]=[],archiveError=false;
 try{history=await readArchive(db,'sync_runs',master);}catch{archiveError=true;}
 return {current,archiveError,history:history.map(r=>({id:String(r.id),kind:String(r.sync_type),status:String(r.status),item_count:Number(r.items_found||0),started_at:r.started_at,finished_at:r.completed_at,message:r.error_message?'Legacy attempt reported an error (details withheld)':'Legacy log',legacy:true})).sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at))).slice(0,250)};
}
