const Parser=require('rss-parser');
const {safeFetch}=require('../utils/network');
const {generateId,nowISO,normalizeDate}=require('../utils/helpers');
const PLAYLIST_ID='OLT0p76Cd7kYMmbBNlt_TvC4vzjFTMKMNjw';
const PLAYLIST_URL=`https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
async function syncYouTubePlaylist(db){const started=nowISO();let status='ERROR',error=null,items=[],title=null;try{const r=await safeFetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST_ID}`);if(!r.ok)throw Error('Feed HTTP '+r.status);const xml=await r.text();if(!xml.includes(PLAYLIST_ID))throw Error('Identitas playlist tidak dapat diverifikasi');const feed=await new Parser({customFields:{item:['yt:videoId']}}).parseString(xml);title=feed.title;items=feed.items||[];status=items.length?'HEALTHY':'EMPTY';}catch(e){error=e.message;try{const r=await safeFetch(PLAYLIST_URL);if(!r.ok)throw Error('Halaman HTTP '+r.status);const html=await r.text();const m=html.match(/(?:var ytInitialData\s*=\s*|window\["ytInitialData"\]\s*=\s*)(\{.*?\});<\/script>/s);if(!m)throw Error('Metadata playlist tidak tersedia');const data=JSON.parse(m[1]);const parsed=parsePlaylistData(data,PLAYLIST_ID);items=parsed.items;title=parsed.title;
if(!items.length)throw Error('Tidak ada item playlist tervalidasi');status='PARTIAL';error='Feed tidak tersedia; memakai metadata halaman publik. Tanggal publikasi yang tidak tersedia tetap null.';}catch(e2){status='UNSUPPORTED';error+='; '+e2.message;}}
const at=nowISO();db.transaction(()=>{for(const i of items){const video=i['yt:videoId'];if(!/^[\w-]{11}$/.test(video||'')||!i.title)continue;const old=db.prepare('SELECT * FROM youtube_music_items WHERE video_id=?').get(video);db.prepare('INSERT OR REPLACE INTO youtube_music_items(id,video_id,playlist_id,title,channel_title,thumbnail_url,video_url,video_published_at,added_to_playlist_at,first_seen_at,last_seen_at,is_music,category,source_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(old?.id||generateId(),video,PLAYLIST_ID,i.title,i.creator||old?.channel_title||'',i.thumbnail||old?.thumbnail_url||null,`https://www.youtube.com/watch?v=${video}`,normalizeDate(i.isoDate)||old?.video_published_at||null,old?.added_to_playlist_at||null,old?.first_seen_at||at,at,/official music video|official audio|\bMV\b|lyrics|official performance/i.test(i.title)?1:0,'Klasifikasi aturan awal',status);}})();db.prepare('INSERT INTO sync_runs(id,sync_type,started_at,completed_at,status,items_found,error_count,error_message,duration_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(generateId(),'youtube',started,at,status,items.length,status==='UNSUPPORTED'?1:0,error,Date.parse(at)-Date.parse(started));return {status,itemsFound:items.length,errorMessage:error,playlistTitle:title};}
function parsePlaylistData(data,playlistId){
 const meta=data.metadata?.playlistMetadataRenderer;
 if(!meta||![meta.androidAppindexingLink,meta.iosAppindexingLink].some(x=>typeof x==='string'&&x.includes('list='+playlistId)))throw Error('Identitas halaman playlist tidak dapat diverifikasi');
 const items=[],seen=new Set();
 function add(v){const id=v['yt:videoId'];if(/^[\w-]{11}$/.test(id||'')&&v.title&&!seen.has(id)){seen.add(id);items.push(v);}}
 function walk(o){if(!o||typeof o!=='object')return;
 if(o.playlistVideoRenderer){const v=o.playlistVideoRenderer;add({'yt:videoId':v.videoId,title:v.title?.runs?.map(x=>x.text).join('')||v.title?.simpleText,creator:v.shortBylineText?.runs?.map(x=>x.text).join('')||'',thumbnail:v.thumbnail?.thumbnails?.at(-1)?.url});return;}
 if(o.lockupViewModel){const v=o.lockupViewModel;if(v.contentType==='LOCKUP_CONTENT_TYPE_VIDEO'){const m=v.metadata?.lockupMetadataViewModel;const parts=m?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts||[];const channel=parts.find(p=>p.text?.commandRuns?.some(r=>r.onTap?.innertubeCommand?.browseEndpoint))?.text?.content||'';add({'yt:videoId':v.contentId,title:m?.title?.content,creator:channel,thumbnail:v.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url});}return;}
 for(const v of Object.values(o))walk(v);
 }
 // Only selected playlist content, never sidebar recommendations or action menus.
 const tabs=data.contents?.twoColumnBrowseResultsRenderer?.tabs||data.contents?.singleColumnBrowseResultsRenderer?.tabs||[];
 const selected=tabs.find(t=>t.tabRenderer?.selected)?.tabRenderer?.content;if(!selected)throw Error('Konten playlist terpilih tidak ditemukan');walk(selected);
 return {title:meta.title||null,items};
}
module.exports={syncYouTubePlaylist,PLAYLIST_ID,PLAYLIST_URL,parsePlaylistData};
