import type {Client} from '@libsql/client';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import {publicFetch,checkRobots} from '../security/public-fetch';
import {acceptSourceItem,normalizeArticleUrl,sourceTime} from './editorial';
import {runJob} from './operations';
import {prepareCore} from './schema-core';
import {pickImageFromPage,hostReady,markHost} from './article-image';
import {verifyListing} from './listing-runtime';
function plain(raw:unknown,max:number){const $=cheerio.load(String(raw||''));$('script,style,noscript').remove();return $.text().replace(/\s+/g,' ').trim().slice(0,max);}
export function feedDate(item:{pubDate?:string;isoDate?:string}){const raw=item.pubDate||item.isoDate||null;if(!raw||!/(?:Z|[+-]\d{2}:?\d{2}|\bGMT|\bUTC)\s*$/i.test(raw))return {published:null,raw};try{return {published:sourceTime(item.isoDate||raw),raw};}catch{return {published:null,raw};}}
async function source(db:Client,id:string){
 const r=(await db.execute({sql:"SELECT * FROM hub_sources WHERE id=? AND source_kind='rss'",args:[id]})).rows[0];
 if(!r)throw Error('SOURCE_NOT_READY');
 // Sumber yang ditambahkan sebelum perbaikan tidak punya feed_url. Pakai requested_url sebagai
 // cadangan supaya sumber itu tidak perlu dihapus lalu dimasukkan ulang.
 if(!r.feed_url&&r.requested_url){await db.execute({sql:'UPDATE hub_sources SET feed_url=? WHERE id=? AND feed_url IS NULL',args:[String(r.requested_url),id]});r.feed_url=r.requested_url;}
 if(!r.feed_url)throw Error('SOURCE_NOT_READY');
 return r;}
/** Jumlah item teratas yang diambil per tarikan. Terlalu kecil = berita hilang selamanya,
 *  karena tarikan berikutnya hanya melihat item yang lebih baru lagi. */
export const ITEMS_PER_SYNC = Number(process.env.HUB_RSS_ITEMS_PER_SYNC ?? 30);
async function feedItems(url:string){await checkRobots(url);const xml=await publicFetch(url);if(!/^\s*(?:<\?xml[^>]*>\s*)?<(?:rss\b|feed\b|rdf:RDF\b)/i.test(xml))throw Error('RSS_INVALID');const feed=await new Parser().parseString(xml);if(!feed.items?.length)throw Error('RSS_INVALID');return feed.items;}
export async function verifyRss(db:Client,id:string){const s=await source(db,id);return runJob(db,'rss-verify:'+id,async()=>{const items=await feedItems(String(s.feed_url));await db.execute({sql:"UPDATE hub_sources SET discovered_type='rss',updated_at=? WHERE id=?",args:[new Date().toISOString(),id]});return {value:{verified:true,count:items.length,active:Number(s.is_active)===1},count:items.length};});}
/**
 * Mengaktifkan sumber TIDAK boleh menghapus pernyataan hak yang sudah dibuat manusia.
 * Hak hanya diisi 'metadata_only' bila statusnya masih 'unknown'.
 */
export async function setRssActive(db:Client,id:string,active:boolean){const s=await source(db,id);if(active&&s.discovered_type!=='rss')throw Error('SOURCE_NOT_READY');await db.execute({sql:"UPDATE hub_sources SET is_active=?,rights_status=CASE WHEN ?=1 AND rights_status='unknown' THEN 'metadata_only' ELSE rights_status END,updated_at=? WHERE id=?",args:[active?1:0,active?1:0,new Date().toISOString(),id]});return {active,rights:String(s.rights_status||'unknown')};}
export async function syncRss(db:Client,id:string){await prepareCore(db).catch(()=>{});const s=await source(db,id);if(Number(s.is_active)!==1||s.discovered_type!=='rss'||s.rights_status==='unknown')throw Error('SOURCE_NOT_READY');return runJob(db,'rss:'+id,async()=>{const items=(await feedItems(String(s.feed_url))).slice(0,ITEMS_PER_SYNC);let inserted=0,skipped=0,invalid=0,filled=0,pageImages=0;
 // Sebagian penerbit mengirim feed TANPA gambar sama sekali, padahal halaman artikelnya punya.
 // Untuk item baru yang gambarnya kosong, halaman artikelnya dibaca SEKALI (robots + crawl-delay
 // dihormati) hanya untuk mengambil alamat gambar. Dibatasi agar tetap sopan dan tidak melewati
 // anggaran waktu putaran.
 const startedAt=Date.now();let pageTries=0;
 const PAGE_IMAGE_MAX=4;              // per sumber per putaran
 const PAGE_IMAGE_BUDGET_MS=25_000;   // berhenti mencoba setelah 25 detik
 const fillFromPage=async(itemId:string,pageUrl:string)=>{
   if(pageTries>=PAGE_IMAGE_MAX||Date.now()-startedAt>PAGE_IMAGE_BUDGET_MS)return false;
   let host:string;try{host=new URL(pageUrl).hostname.toLowerCase();}catch{return false;}
   if(!await hostReady(db,host))return false;   // Crawl-delay: 10 → jarak minimal 10 detik per host
   pageTries+=1;await markHost(db,host);
   const img=await pickImageFromPage(pageUrl);
   if(!img)return false;
   await db.execute({sql:'UPDATE hub_items SET source_image_url=? WHERE id=? AND (source_image_url IS NULL OR source_image_url=?)',args:[img,itemId,'']});
   pageImages+=1;return true;
 };
 for(const item of items){let normalized:string;try{normalized=normalizeArticleUrl(item.link||'');}catch{invalid++;continue;}
  const title=plain(item.title,300);if(!title){invalid++;continue;}
  // Legacy identity keys differ from feed GUID keys: preserve existing records and human edits.
  const existing=(await db.execute({sql:'SELECT id,source_image_url FROM hub_items WHERE source_id=? AND normalized_original_url=? LIMIT 1',args:[id,normalized]})).rows[0];
  if(existing){
    // Isi gambar yang dulu tidak pernah diambil (data lama) tanpa mengubah identitas/versi berita.
    const img=pickImage(item);
    if(img&&!existing.source_image_url){await db.execute({sql:'UPDATE hub_items SET source_image_url=? WHERE id=?',args:[img,String(existing.id)]});filled++;}
    // Termasuk berita yang SUDAH ada tetapi feed-nya memang tak pernah membawa gambar:
    // halaman artikelnya dibaca sekali (robots + crawl-delay dihormati). Ini yang membuat berita
    // Bali Puspa News yang telanjur terbit akhirnya mendapat gambar, lalu dirapikan langkah
    // `image_repair` pada putaran yang sama.
    else if(!img&&!existing.source_image_url)await fillFromPage(String(existing.id),normalized);
    skipped++;continue;
  }
  const d=feedDate(item);const externalId=typeof item.guid==='string'&&item.guid.length<=500?item.guid:null;
  const feedImage=pickImage(item);
  const result=await acceptSourceItem(db,{sourceId:id,externalId,url:normalized,title,snippet:plain(item.contentSnippet||item.summary||item.content||'',1500)||null,sourcePublishedAt:d.published,sourceDateRaw:d.raw?.slice(0,150)||null,imageUrl:feedImage});
  if(result.status==='inserted'){
    inserted++;
    // Feed tanpa gambar → coba halaman artikel (hanya untuk berita baru, jumlahnya dibatasi).
    if(!feedImage)await fillFromPage(String(result.id),normalized);
  }else skipped++;
 }
 return {value:{inserted,skipped,invalid,filled,pageImages,processed:items.length,publicationEnabled:false},count:inserted,status:invalid?'PARTIAL':'SUCCESS'};
 });}

/** Baca feed TANPA menulis apa pun — dipakai diagnosa tarikan. */
export async function peekFeed(url:string,limit=ITEMS_PER_SYNC){
  const items=await feedItems(url);
  return items.slice(0,limit).map(it=>{
    const d=feedDate(it);let normalized:string|null=null,urlError:string|null=null;
    try{normalized=normalizeArticleUrl(it.link||'');}catch(e){urlError=(e instanceof Error?e.message:'').replace(/[^A-Z0-9_]/g,'').slice(0,40)||'URL_INVALID';}
    const externalId=typeof it.guid==='string'&&it.guid.length<=500?it.guid:null;
    return {title:plain(it.title||'',300),link:String(it.link||'')||null,normalized,urlError,dateRaw:d.raw,published:d.published,externalId};
  });
}

/**
 * Satu saklar untuk RSS Manager.
 *
 * Menyalakan sumber = pernyataan pemilik: "boleh diambil dan diterbitkan".
 * Karena itu satu tindakan ini sekaligus (a) memvalidasi feed, (b) mengaktifkan sumber,
 * (c) menaikkan hak ke permission_confirmed BILA belum pernah dinyatakan.
 * Tidak ada tombol "Validasi feed" atau "Tandai hak" terpisah di antarmuka.
 *
 * Mematikan sumber hanya mematikan; pernyataan hak yang sudah ada TIDAK dihapus.
 * Bila feed tidak terbaca, sumber tetap nonaktif dan tidak ada perubahan hak.
 */
export async function toggleSource(db:Client,id:string,active:boolean,opts:{verify?:(d:Client,i:string)=>Promise<{count:number}>}={}){
  const now=new Date().toISOString();
  if(!active){await db.execute({sql:'UPDATE hub_sources SET is_active=0,updated_at=? WHERE id=?',args:[now,id]});return {active:false,rights:String((await db.execute({sql:'SELECT rights_status FROM hub_sources WHERE id=?',args:[id]})).rows[0]?.rights_status||'unknown')};}
  const s=await source(db,id);
  if(s.discovered_type!=='rss'){
    // Sumber berjenis 'listing' (tanpa RSS) diperiksa dengan membaca halaman daftarnya.
    const verify=opts.verify??((d:Client,i:string)=>String(s.discovered_type)==='html_listing'?verifyListing(d,i):verifyRss(d,i));
    await verify(db,id); // melempar bila feed tidak terbaca → sumber tetap nonaktif
  }
  await db.execute({sql:"UPDATE hub_sources SET is_active=1, rights_status=CASE WHEN rights_status='unknown' THEN 'permission_confirmed' ELSE rights_status END, updated_at=? WHERE id=?",args:[now,id]});
  const row=(await db.execute({sql:'SELECT rights_status FROM hub_sources WHERE id=?',args:[id]})).rows[0];
  return {active:true,rights:String(row?.rights_status||'unknown')};
}

/** Ambil URL gambar asli dari item feed. TIDAK menyalin/menyimpan gambar — hanya URL-nya. */
export function pickImage(item:any):string|null{
  const ok=(v:unknown)=>{if(typeof v!=='string')return null;const t=v.trim();if(!/^https:\/\//i.test(t)||t.length>600)return null;try{new URL(t);return t;}catch{return null;}};
  const cands:string[]=[];
  const push=(v:unknown)=>{const u=ok(v);if(u)cands.push(u);};
  push(item?.enclosure?.url);push(item?.enclosure?.link);
  for(const k of ['media:content','media:thumbnail'])  {
    const raw=item?.[k];
    if(Array.isArray(raw))for(const r of raw)push(r?.$?.url||r?.url);
    else push(raw?.$?.url||raw?.url);
  }
  const html=String(item?.content||item?.summary||item?.['content:encoded']||'');
  const m=html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if(m)push(m[1]);
  return cands[0]||null;
}
