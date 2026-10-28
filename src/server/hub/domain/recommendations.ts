import type {Client} from '@libsql/client';
import {sourceTime} from './editorial';
import {detectMixSubtype, selectDiverse, MIX_SUBTYPE_LABEL, type MixSubtype, type SelectionCandidate} from './variety';
const TERMS:Record<string,string[]>={NTB:['nusa tenggara barat','ntb','lombok','mataram','sumbawa','bima','dompu','taliwang'],Bali:['bali','denpasar','badung','gianyar','tabanan','jembrana','karangasem','buleleng','klungkung','bangli'],NTT:['nusa tenggara timur','ntt','kupang','flores','manggarai','ende','maumere','labuan bajo','rote','alor','lembata','sumba']};
export function geography(title:string,snippet:string){const hits=(text:string,term:string)=>new RegExp('(?<![\\p{L}])'+term+'(?![\\p{L}])','iu').test(text);const regions=Object.entries(TERMS).filter(([,terms])=>terms.some(t=>hits(title,t))||terms.filter(t=>hits(snippet,t)).length>=2).map(([r])=>r);return {regions,kind:regions.length?'regional':/\b(indonesia|nasional|seluruh provinsi|pemerintah pusat)\b/i.test(title+' '+snippet)?'national':'unknown'};}
function canonical(raw:string){try{const u=new URL(raw);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/.test(k))u.searchParams.delete(k);return u.href;}catch{return raw;}}
function riskFlagged(profileJson:unknown){
 try{const parsed=typeof profileJson==='string'?JSON.parse(profileJson):profileJson;return !!parsed&&parsed.risk?.status==='needs_review';}catch{return false;}
}
export function rankCandidates(rows:Record<string,unknown>[],hours:number,now=Date.now()){
 const pool:SelectionCandidate[]=[];const view:Record<string,Record<string,unknown>>={};const seen=new Set<string>();
 let excluded=0,excludedUnknownGeography=0;
 for(const r of rows){
  const title=String(r.editorial_title||r.source_title||''),snippet=String(r.source_snippet||'');let stamp:string|null=null;
  try{stamp=sourceTime(r.source_published_at);}catch{}
  const t=stamp?Date.parse(stamp):NaN;
  if(!Number.isFinite(t)||t>now+300000||t<now-hours*3600000||r.review_state==='rejected'||r.review_state==='identity_review'){excluded++;continue;}
  const g=geography(title,snippet);const mix=detectMixSubtype(title,snippet);
  if(g.kind==='unknown'&&!mix){excluded++;excludedUnknownGeography++;continue;}
  const key=canonical(String(r.normalized_original_url||r.original_url));if(seen.has(key))continue;seen.add(key);
  const category=String(r.editorial_category||'');
  const entertainment=!!mix||/hiburan|musik|film|game|showbiz|lifestyle|olahraga/i.test(category+' '+title);
  const regionKind:SelectionCandidate['regionKind']=g.kind==='regional'?'regional':'national';
  const flagged=riskFlagged(r.profile_json);
  pool.push({id:String(r.id),score:Math.round(60*Math.exp(-Math.max(0,now-t)/86400000)+(g.kind==='regional'?20:0)),group:entertainment?'entertainment':'news',regionKind,mix,mixRiskFlagged:flagged});
  view[String(r.id)]={id:String(r.id),title,summary:r.editorial_summary||r.source_snippet||null,sourceUrl:String(r.original_url),sourceName:String(r.source_name||''),publishedAt:stamp,reviewState:String(r.review_state),regions:g.regions,group:entertainment?'entertainment':'news',mix: mix?{subtype:mix,label:MIX_SUBTYPE_LABEL[mix as MixSubtype]}:null,riskSignal:flagged?'perlu tinjauan':'belum dinilai',profileReady:!!r.profile_json,score:pool[pool.length-1].score};
 }
 const selection=selectDiverse(pool,50);
 const items=selection.items.map(c=>view[c.id]);
 return {items,eligibleTotal:pool.length,excluded,excludedUnknownGeography,mix:selection.mix,
  policy:{algorithm:'deterministic_not_ai',freshnessHours:hours,regionalFocus:['Bali','NTB','NTT'],nationalMaximumShare:.2,targetNewsShare:.6,ratioGuaranteed:false,
   mixShareTarget:[.05,.10],mixShareCap:.10,mixCountsWithinNationalShare:true,mixQuotaGuaranteed:false,mixPolicy:selection.mix.counting,profilesOptional:true,publicationEnabled:false}};
}
const CANDIDATE_SQL="SELECT i.*,s.name source_name FROM hub_items i JOIN hub_sources s ON s.id=i.source_id WHERE i.review_state NOT IN ('rejected','identity_review') ORDER BY julianday(i.source_published_at) DESC,i.id LIMIT 2000";
export async function recommendations(db:Client,hours:number){
 let rows:Record<string,unknown>[];let profilesJoined=true;
 try{rows=(await db.execute("SELECT i.*,s.name source_name,p.profile_json FROM hub_items i JOIN hub_sources s ON s.id=i.source_id LEFT JOIN hub_content_profiles_v2 p ON p.item_id=i.id WHERE i.review_state NOT IN ('rejected','identity_review') ORDER BY julianday(i.source_published_at) DESC,i.id LIMIT 2000")).rows;}
 catch{profilesJoined=false;rows=(await db.execute(CANDIDATE_SQL)).rows;}
 const ranked=rankCandidates(rows,hours);
 return {...ranked,profilesJoined,candidatesExamined:rows.length,candidateLimit:2000,profilesHint:profilesJoined?'Profil risiko dari Langkah 2 dipakai bila tersedia.':'Tabel profil belum siap; kandidat hiburan tetap dinilai dari kata pada judul/cuplikan saja.'};
}
