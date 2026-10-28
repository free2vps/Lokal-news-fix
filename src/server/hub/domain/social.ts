import type {Client} from '@libsql/client';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import {publicFetch,checkRobots} from '../security/public-fetch';
import {readArchive} from './archive';
import {dataset,storeDataset,runJob,PLAYLIST} from './operations';
import {sourceTime} from './editorial';
export const X_URL='https://trends24.in/indonesia/';
export function parseX(html:string){
 const $=cheerio.load(html),cards=$('h3[data-timestamp]').toArray().map(e=>({e,t:Number($(e).attr('data-timestamp')),label:$(e).text().replace(/\s+/g,' ').trim().toLowerCase()})).filter(c=>Number.isFinite(c.t)&&c.t>0&&$(c.e).parent().find('ol.trend-card__list').length);
 const latest=Math.max(...cards.map(c=>c.t));const candidate=cards.filter(c=>/^1 hour ago$/.test(c.label)&&latest-c.t>=2700&&latest-c.t<=5400).sort((a,b)=>b.t-a.t)[0];
 if(!candidate)throw Error('X_ONE_HOUR_UNAVAILABLE');
 const seen=new Set<string>(),items:{text:string;rank:number}[]=[];
 $(candidate.e).parent().find('ol.trend-card__list > li').each((index,el)=>{const text=$(el).find('a.trend-link').first().text().replace(/\s+/g,' ').trim();const key=text.normalize('NFKC').toLowerCase();if(text&&text.length<=200&&!seen.has(key)){seen.add(key);items.push({text,rank:index+1});}});
 if(!items.length)throw Error('X_ONE_HOUR_UNAVAILABLE');
 return {items,sourceUrl:X_URL,selectionLabel:'1 hour ago',sourceSnapshotAt:new Date(candidate.t*1000).toISOString(),sourceLatestAt:new Date(latest*1000).toISOString()};
}
export async function syncX(db:Client){return runJob(db,'x',async()=>{await checkRobots(X_URL,['trends24.in']);const parsed=parseX(await publicFetch(X_URL,1500000,['trends24.in']));const value={...parsed,observedAt:new Date().toISOString(),origin:'manual_sync'};await storeDataset(db,'x',value);return {value,count:parsed.items.length};});}
export async function getX(db:Client,master:string|undefined){
 const live=await dataset(db,'x');if(live)return {...live,stale:Date.now()-Date.parse(live.observedAt)>7200000||Date.now()-Date.parse(live.sourceSnapshotAt)>10800000};
 const snaps=await readArchive(db,'x_trend_snapshots',master),all=await readArchive(db,'x_trend_items',master);
 const selected=snaps.filter(s=>s.source_url===X_URL&&s.selection_label==='1 hour ago'&&['HEALTHY','PARTIAL'].includes(String(s.status))).sort((a,b)=>String(b.fetched_at).localeCompare(String(a.fetched_at)))[0];
 if(!selected)return {items:[],origin:'legacy_archive',stale:true,selectionLabel:'1 hour ago'};
 const items=all.filter(r=>r.snapshot_id===selected.id).sort((a,b)=>Number(a.rank)-Number(b.rank)).map(r=>({text:String(r.trend_text),rank:Number(r.rank)}));
 return {items,sourceUrl:X_URL,selectionLabel:'1 hour ago',sourceSnapshotAt:selected.source_snapshot_at||null,sourceLatestAt:selected.source_latest_at||null,observedAt:selected.fetched_at,origin:'legacy_archive',stale:true};
}
export async function parseYoutube(xml:string){
 // Match the exact playlist ID in Atom metadata, not a loose substring of a title.
 const $=cheerio.load(xml,{xml:true});
 const ids=$('feed > id').map((_,e)=>$(e).text()).get();
 const self=$('feed > link[rel="self"]').map((_,e)=>$(e).attr('href')||'').get();
 const expected=ids.some(id=>id==='yt:playlist:'+PLAYLIST)||self.some(h=>{try{const u=new URL(h);return u.protocol==='https:'&&u.hostname==='www.youtube.com'&&u.pathname==='/feeds/videos.xml'&&u.searchParams.get('playlist_id')===PLAYLIST;}catch{return false;}});
 if(!expected)throw Error('PLAYLIST_UNAVAILABLE');
 const parser=new Parser({customFields:{item:['yt:videoId']}});const feed=await parser.parseString(xml);const seen=new Set<string>();
 const items=(feed.items||[]).flatMap(i=>{const video=String((i as any)['yt:videoId']||'');if(!/^[\w-]{11}$/.test(video)||!i.title||seen.has(video))return [];seen.add(video);let publishedAt:string|null=null;try{publishedAt=sourceTime(i.isoDate);}catch{}
 return [{videoId:video,title:i.title.slice(0,500),channel:i.creator?.slice(0,200)||'',videoUrl:'https://www.youtube.com/watch?v='+video,publishedAt}];}).slice(0,50);
 if(!items.length)throw Error('PLAYLIST_UNAVAILABLE');return {title:feed.title||null,items};
}
export async function syncYoutube(db:Client){return runJob(db,'youtube',async()=>{const feed='https://www.youtube.com/feeds/videos.xml?playlist_id='+PLAYLIST;await checkRobots(feed,['www.youtube.com']);const parsed=await parseYoutube(await publicFetch(feed,1500000,['www.youtube.com']));const value={...parsed,playlistId:PLAYLIST,sourceUrl:'https://www.youtube.com/playlist?list='+PLAYLIST,observedAt:new Date().toISOString(),origin:'manual_feed',partial:true};await storeDataset(db,'youtube',value);return {value,count:parsed.items.length,status:'PARTIAL'};});}
export async function getYoutube(db:Client,master:string|undefined){const live=await dataset(db,'youtube');if(live)return {...live,stale:Date.now()-Date.parse(live.observedAt)>86400000};
 const rows=(await readArchive(db,'youtube_music_items',master)).filter(r=>r.playlist_id===PLAYLIST&&/^[\w-]{11}$/.test(String(r.video_id)));
 return {items:rows.map(r=>({videoId:String(r.video_id),title:String(r.title),channel:String(r.channel_title||''),videoUrl:'https://www.youtube.com/watch?v='+r.video_id,publishedAt:r.video_published_at||null})),playlistId:PLAYLIST,sourceUrl:'https://www.youtube.com/playlist?list='+PLAYLIST,observedAt:rows.map(r=>String(r.last_seen_at||'')).sort().at(-1)||null,origin:'legacy_archive',stale:true,partial:true};
}
