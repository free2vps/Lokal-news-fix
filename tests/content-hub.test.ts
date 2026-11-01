import test from 'node:test';import assert from 'node:assert/strict';
import {mapHubArticle,mapHubTrends,safeUrl} from '../src/lib/content-hub/mapping';
const now=Date.now();
const article={id:'sample',kind:'article',contentGroup:'news',title:'Beasiswa mahasiswa NTB tersedia',summary:'Pendaftaran beasiswa dibuka untuk mahasiswa.',source_name:'Penerbit uji',original_url:'https://example.com/article',published_at:new Date(now).toISOString(),editorial_category:'Pendidikan',keywords:'["beasiswa","mahasiswa"]'};
test('map article matches current website schema',()=>{const a=mapHubArticle(article,now)!;assert.equal(a.ai_summary,article.summary);assert.equal(a.section,'berita');assert.equal(a.category,'Pendidikan');assert.deepEqual(a.tags,['beasiswa','mahasiswa']);assert.equal(a.region,'ntb');assert.match(a.slug,/-hub-/);assert.equal(a.source_url,article.original_url);});
test('stable slug and original date',()=>assert.deepEqual(mapHubArticle(article,now),mapHubArticle(article,now)));
test('reject title/date fabrication, stale and future',()=>{for(const patch of [{published_at:null},{published_at:new Date(now-80*3600000).toISOString()},{published_at:new Date(now+3600000).toISOString()},{original_url:'javascript:alert(1)'},{kind:'youtube'},{title:''}])assert.equal(mapHubArticle({...article,...patch},now),null);});
test('category mapping and bad keywords',()=>{const a=mapHubArticle({...article,contentGroup:'entertainment',editorial_category:'Musik dan Hiburan',keywords:'invalid'},now)!;assert.equal(a.category,'Film & Musik');assert.equal(a.section,'hiburan');assert.deepEqual(a.tags,[]);});
test('X preserves source snapshot and stale warning without metrics fabrication',()=>{const r=mapHubTrends({sourceSnapshotAt:new Date(now-4*3600000).toISOString(),lastValidSnapshot:{},items:[{trendText:'#Topik',rank:7}]},[],now);assert.equal(r[0].rank,7);assert.match(r[0].metric!,/data lama/);assert.match(r[0].metric!,/1 hour ago/);assert.equal(r[0].platform,'x_t24');});
test('YouTube only music-classified valid video IDs',()=>{const r=mapHubTrends(null,[{video_id:'abcdefghijk',title:'Official audio',is_music:1,channel_title:'Channel'},{video_id:'bad',title:'invalid',is_music:1},{video_id:'lmnopqrstuv',title:'Not classified',is_music:0}],now);assert.equal(r.length,1);assert.equal(r[0].platform,'yt_feed');assert.equal(r[0].kind,'video');});
test('URL schemes and credentials rejected',()=>{assert.equal(safeUrl('file:///etc/passwd'),null);assert.equal(safeUrl('https://a:b@example.com'),null);});

import { importContentHub } from '../src/lib/content-hub/import';
import type { supabaseAdmin } from '../src/lib/supabase';
function databaseFixture(){
 const cache=new Map<string,unknown>(),articles=new Map<string,unknown>();let owner:string|null=null;
 const mock={rpc:async(name:string,args:{lease_owner:string})=>{if(name==='acquire_content_hub_lease'){if(owner)return {data:false,error:null};owner=args.lease_owner;return {data:true,error:null};}if(owner===args.lease_owner)owner=null;return {data:null,error:null};},from:(table:string)=>({upsert:(data:unknown)=>{if(table==='content_hub_cache'){const row=data as {key:string;payload:unknown};cache.set(row.key,row.payload);return Promise.resolve({error:null});}return {select:async()=>{const inserted:unknown[]=[];for(const row of data as {source_url:string}[]){if(!articles.has(row.source_url)){articles.set(row.source_url,row);inserted.push({id:articles.size});}}return {data:inserted,error:null};}};}})};
 return {cache,articles,db:mock as unknown as ReturnType<typeof supabaseAdmin>};
}
test('complete import stores articles and X/YouTube separately; repeat is idempotent',async()=>{
 const mock=databaseFixture();let changed=0;
 const load=async(type:string)=>type==='recommended'?{ok:true,items:[article]}:type==='x-trends'?{ok:true,data:{xTrends:{items:[{trendText:'#Actual'}],lastValidSnapshot:{status:'HEALTHY'}}}}:{ok:true,data:{youtubeMusic:[{video_id:'abcdefghijk',is_music:1,title:'Official Audio'}]}};
 const deps={db:mock.db,load,changed:()=>{changed++;}};
 const first=await importContentHub({},deps);assert.equal(first.inserted,1);assert.equal(first.errors.length,0);assert.equal(mock.cache.size,3);
 const again=await importContentHub({},deps);assert.equal(again.inserted,0);assert.equal(again.skipped,1);assert.equal(mock.articles.size,1);assert.equal(changed,2);
 const old=[...mock.cache.entries()];const offline=await importContentHub({},{...deps,load:async()=>{throw Error('network offline');}});assert.equal(offline.errors.length,3);assert.deepEqual([...mock.cache.entries()],old);assert.equal(mock.articles.size,1);
});
test('failed X does not stop valid YouTube snapshot',async()=>{
 const mock=databaseFixture();const result=await importContentHub({articles:false},{db:mock.db,changed:()=>{},load:async(type:string)=>{if(type==='x-trends')throw Error('X unavailable');return {ok:true,data:{youtubeMusic:[{video_id:'abcdefghijk'}]}};}});assert.equal(result.errors.length,1);assert.ok(mock.cache.has('youtube-music'));
});
test('concurrent importer skips without fetching',async()=>{
 const mock=databaseFixture();await mock.db.rpc('acquire_content_hub_lease',{lease_owner:'owner'});let calls=0;const result=await importContentHub({},{db:mock.db,changed:()=>{},load:async()=>{calls++;return {};}});assert.equal(calls,0);assert.equal(result.skipped,1);
});
