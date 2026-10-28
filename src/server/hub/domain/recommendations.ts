import type {Client} from '@libsql/client';
import {sourceTime} from './editorial';
const TERMS:Record<string,string[]>={NTB:['nusa tenggara barat','ntb','lombok','mataram','sumbawa','bima','dompu','taliwang'],Bali:['bali','denpasar','badung','gianyar','tabanan','jembrana','karangasem','buleleng','klungkung','bangli'],NTT:['nusa tenggara timur','ntt','kupang','flores','manggarai','ende','maumere','labuan bajo','rote','alor','lembata','sumba']};
export function geography(title:string,snippet:string){const hits=(text:string,term:string)=>new RegExp('(?<![\\p{L}])'+term+'(?![\\p{L}])','iu').test(text);const regions=Object.entries(TERMS).filter(([,terms])=>terms.some(t=>hits(title,t))||terms.filter(t=>hits(snippet,t)).length>=2).map(([r])=>r);return {regions,kind:regions.length?'regional':/\b(indonesia|nasional|seluruh provinsi|pemerintah pusat)\b/i.test(title+' '+snippet)?'national':'unknown'};}
function canonical(raw:string){try{const u=new URL(raw);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/.test(k))u.searchParams.delete(k);return u.href;}catch{return raw;}}
export function rankCandidates(rows:Record<string,unknown>[],hours:number,now=Date.now()){
 const regional:Record<string,unknown>[]=[],national:Record<string,unknown>[]=[],seen=new Set<string>();let excluded=0;
 for(const r of rows){
  const title=String(r.editorial_title||r.source_title||''),snippet=String(r.source_snippet||'');let stamp:string|null=null;
  try{stamp=sourceTime(r.source_published_at);}catch{}
  const t=stamp?Date.parse(stamp):NaN;
  if(!Number.isFinite(t)||t>now+300000||t<now-hours*3600000||r.review_state==='rejected'||r.review_state==='identity_review'){excluded++;continue;}
  const g=geography(title,snippet);if(g.kind==='unknown'){excluded++;continue;}
  const key=canonical(String(r.normalized_original_url||r.original_url));if(seen.has(key))continue;seen.add(key);
  const category=String(r.editorial_category||'');const entertainment=/hiburan|musik|film|game|showbiz|lifestyle|olahraga/i.test(category+' '+title);
  const item={id:String(r.id),title,summary:r.editorial_summary||r.source_snippet||null,sourceUrl:String(r.original_url),sourceName:String(r.source_name||''),publishedAt:stamp,reviewState:String(r.review_state),regions:g.regions,group:entertainment?'entertainment':'news',score:Math.round(60*Math.exp(-Math.max(0,now-t)/86400000)+(g.kind==='regional'?20:0))};
  (g.kind==='regional'?regional:national).push(item);
 }
 const sort=(a:Record<string,unknown>,b:Record<string,unknown>)=>Number(b.score)-Number(a.score)||String(a.id).localeCompare(String(b.id));regional.sort(sort);national.sort(sort);
 const news=regional.filter(r=>r.group==='news'),entertainment=regional.filter(r=>r.group==='entertainment'),ordered:Record<string,unknown>[]=[];
 while(news.length||entertainment.length){const wantNews=Math.round((ordered.length+1)*.6)>Math.round(ordered.length*.6);const next=(wantNews?news:entertainment).shift()||(wantNews?entertainment:news).shift();if(next)ordered.push(next);}
 const result:Record<string,unknown>[]=[];let n=0;ordered.forEach((r,i)=>{result.push(r);if((i+1)%4===0&&national[n])result.push(national[n++]);});
 return {items:result.slice(0,50),eligibleTotal:result.length,excluded,policy:{algorithm:'deterministic_not_ai',freshnessHours:hours,regionalFocus:['Bali','NTB','NTT'],nationalMaximumShare:.2,targetNewsShare:.6,ratioGuaranteed:false,publicationEnabled:false}};
}
export async function recommendations(db:Client,hours:number){
 const rows=(await db.execute("SELECT i.*,s.name source_name FROM hub_items i JOIN hub_sources s ON s.id=i.source_id WHERE i.review_state NOT IN ('rejected','identity_review') ORDER BY julianday(i.source_published_at) DESC,i.id LIMIT 2000")).rows;
 return {...rankCandidates(rows,hours),candidatesExamined:rows.length,candidateLimit:2000};
}
