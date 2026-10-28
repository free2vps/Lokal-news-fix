import type {Client} from '@libsql/client';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import {publicFetch,checkRobots} from '../security/public-fetch';
import {acceptSourceItem,normalizeArticleUrl,sourceTime} from './editorial';
import {runJob} from './operations';
function plain(raw:unknown,max:number){const $=cheerio.load(String(raw||''));$('script,style,noscript').remove();return $.text().replace(/\s+/g,' ').trim().slice(0,max);}
export function feedDate(item:{pubDate?:string;isoDate?:string}){const raw=item.pubDate||item.isoDate||null;if(!raw||!/(?:Z|[+-]\d{2}:?\d{2}|\bGMT|\bUTC)\s*$/i.test(raw))return {published:null,raw};try{return {published:sourceTime(item.isoDate||raw),raw};}catch{return {published:null,raw};}}
async function source(db:Client,id:string){const r=(await db.execute({sql:"SELECT * FROM hub_sources WHERE id=? AND source_kind='rss'",args:[id]})).rows[0];if(!r||!r.feed_url)throw Error('SOURCE_NOT_READY');return r;}
async function feedItems(url:string){await checkRobots(url);const xml=await publicFetch(url);if(!/^\s*(?:<\?xml[^>]*>\s*)?<(?:rss\b|feed\b|rdf:RDF\b)/i.test(xml))throw Error('RSS_INVALID');const feed=await new Parser().parseString(xml);if(!feed.items?.length)throw Error('RSS_INVALID');return feed.items;}
export async function verifyRss(db:Client,id:string){const s=await source(db,id);return runJob(db,'rss-verify:'+id,async()=>{const items=await feedItems(String(s.feed_url));await db.execute({sql:"UPDATE hub_sources SET discovered_type='rss',updated_at=? WHERE id=?",args:[new Date().toISOString(),id]});return {value:{verified:true,count:items.length,active:Number(s.is_active)===1},count:items.length};});}
export async function setRssActive(db:Client,id:string,active:boolean){const s=await source(db,id);if(active&&s.discovered_type!=='rss')throw Error('SOURCE_NOT_READY');await db.execute({sql:"UPDATE hub_sources SET is_active=?,rights_status=CASE WHEN ?=1 THEN 'metadata_only' ELSE rights_status END,updated_at=? WHERE id=?",args:[active?1:0,active?1:0,new Date().toISOString(),id]});return {active};}
export async function syncRss(db:Client,id:string){const s=await source(db,id);if(Number(s.is_active)!==1||s.discovered_type!=='rss'||s.rights_status==='unknown')throw Error('SOURCE_NOT_READY');return runJob(db,'rss:'+id,async()=>{const items=(await feedItems(String(s.feed_url))).slice(0,10);let inserted=0,skipped=0,invalid=0;
 for(const item of items){let normalized:string;try{normalized=normalizeArticleUrl(item.link||'');}catch{invalid++;continue;}
  const title=plain(item.title,300);if(!title){invalid++;continue;}
  // Legacy identity keys differ from feed GUID keys: preserve existing records and human edits.
  if((await db.execute({sql:'SELECT id FROM hub_items WHERE source_id=? AND normalized_original_url=? LIMIT 1',args:[id,normalized]})).rows.length){skipped++;continue;}
  const d=feedDate(item);const externalId=typeof item.guid==='string'&&item.guid.length<=500?item.guid:null;
  const result=await acceptSourceItem(db,{sourceId:id,externalId,url:normalized,title,snippet:plain(item.contentSnippet||item.summary||item.content||'',1500)||null,sourcePublishedAt:d.published,sourceDateRaw:d.raw?.slice(0,150)||null});
  if(result.status==='inserted')inserted++;else skipped++;
 }
 return {value:{inserted,skipped,invalid,processed:items.length,publicationEnabled:false},count:inserted,status:invalid?'PARTIAL':'SUCCESS'};
 });}
