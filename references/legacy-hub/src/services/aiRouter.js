const crypto=require('crypto');
const {valid,inputFor,SYSTEM}=require('./mistralNtb');
const {classify}=require('./regional');
const {createStore}=require('./aiSettings');
const ENDPOINTS={openrouter:'https://openrouter.ai/api/v1/chat/completions',groq:'https://api.groq.com/openai/v1/chat/completions',cohere:'https://api.cohere.com/v2/chat',mistral:'https://api.mistral.ai/v1/chat/completions'};
const network=(url,opts)=>require('../utils/network').safeFetch(url,{...opts,timeout:20000});
function migrate(db){db.exec(`CREATE TABLE IF NOT EXISTS hub_ai_cache(cache_key TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS hub_ai_attempts(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,http INTEGER,reason TEXT); CREATE TABLE IF NOT EXISTS hub_ai_circuit(fingerprint TEXT PRIMARY KEY,provider TEXT NOT NULL,until_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS hub_ai_lock(id INTEGER PRIMARY KEY,until_at INTEGER NOT NULL,owner TEXT);`);if(!db.prepare('PRAGMA table_info(hub_ai_lock)').all().some(c=>c.name==='owner'))db.exec('ALTER TABLE hub_ai_lock ADD COLUMN owner TEXT');}
function history(db){migrate(db);return {attempts:db.prepare('SELECT at,provider,model,status,http,reason FROM hub_ai_attempts ORDER BY id DESC LIMIT 30').all(),cooldowns:db.prepare('SELECT provider,MAX(until_at) untilAt FROM hub_ai_circuit WHERE until_at>? GROUP BY provider').all(Date.now())};}
function fingerprint(id,p){return crypto.createHash('sha256').update(id+'|'+p.apiKey).digest('hex');}
function eligible(id,p,mode){return !!p?.apiKey&&!!p.model&&(mode==='evaluation'||p.enabled)&&((id==='cohere'&&mode==='evaluation'&&p.freeConfirmed)||(id==='openrouter'&&(p.model==='openrouter/free'||p.model.endsWith(':free')))||(['groq','mistral'].includes(id)&&p.freeConfirmed));}
async function request(id,p,n,{fetchImpl=network,allowPublic,timeout=20000,onPublicOutput}={}){
 if(!ENDPOINTS[id])throw Error('Provider tidak dikenal');
 const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({title:String(n.title).replace(/<[^>]*>/g,' ').slice(0,500),source_text:inputFor(n)})}];
 const body={model:p.model,messages,temperature:.2,response_format:{type:'json_object'},...(id==='groq'?{max_completion_tokens:1536}:{max_tokens:id==='openrouter'?3000:1536}),...(id==='openrouter'?{provider:{max_price:{prompt:0,completion:0},data_collection:allowPublic?'allow':'deny',require_parameters:true},reasoning:{effort:'low',exclude:true}}:{})};
 const r=await fetchImpl(ENDPOINTS[id],{method:'POST',redirect:'error',signal:AbortSignal.timeout(Math.max(1,timeout)),headers:{'content-type':'application/json',Authorization:'Bearer '+p.apiKey},body:JSON.stringify(body)});
 if(!r.ok){const e=Error('HTTP '+r.status);e.http=r.status;const v=r.headers?.get?.('retry-after');const delay=/^\d+$/.test(v||'')?Number(v)*1000:Date.parse(v||'')-Date.now();e.retry=Math.max(60000,Math.min(86400000,Number.isFinite(delay)?delay:60000));r.body?.destroy?.();throw e;}
 const raw=await r.text();if(raw.length>100000)throw Error('Respons terlalu besar');let d;try{d=JSON.parse(raw);}catch{throw Error('JSON tidak valid');}
 const finish=id==='cohere'?d.finish_reason:d.choices?.[0]?.finish_reason;
 if(['length','MAX_TOKENS','max_tokens'].includes(finish))throw Error('Respons terpotong');
 if(finish&& !['stop','COMPLETE','complete','STOP'].includes(finish))throw Error('Respons tidak selesai');
 const text=id==='cohere'?(d.message?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(''):d.choices?.[0]?.message?.content;
 let value;try{value=JSON.parse(String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw Error('JSON tidak valid');}
 if(onPublicOutput)onPublicOutput(value);
 let payload;try{payload=valid(value,n);}catch(e){const allowed=['Invalid JSON','Invalid field','Invalid length','Invalid category','Invalid tags','Unsupported tag','Unsupported number','Unsafe title','Insufficient grounding'];throw Error('Metadata tidak lolos validasi'+(allowed.includes(e.message)?': '+e.message:''));}
 return {payload,provider:id,model:typeof d.model==='string'&&/^[a-zA-Z0-9_.:/+-]{1,160}$/.test(d.model)?d.model:p.model};
}
async function enrich(db,items,{store=createStore(),config,fetchImpl=network,mode='public',onlyProvider,now=Date.now(),onPublicOutput}={}){
 migrate(db);const s=config||store.read();if(!s)return require('./mistralNtb').enrich(db,items,{fetchImpl,now});
 const report={enabled:s.enabled,processed:0,cached:0,failed:0,skipped:0,attempts:[]};
 if(!s.enabled||!s.allowPublic)return {items,report};
 const providers=(onlyProvider?[onlyProvider]:s.order).filter(id=>eligible(id,s.providers[id],mode));if(!providers.length)report.note='Tidak ada provider yang memenuhi syarat; hanya cache valid yang dapat digunakan';
 const lease=Date.now()+120000,owner=crypto.randomUUID();const locked=db.prepare('INSERT INTO hub_ai_lock(id,until_at,owner) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET until_at=excluded.until_at,owner=excluded.owner WHERE until_at<=?').run(lease,owner,Date.now()).changes;if(!locked)return {items,report:{...report,note:'Pemrosesan AI lain sedang berjalan'}};
 const output=[],deadline=Date.now()+50000;let attempted=0;
 try{for(const n of items){
  if(n.kind!=='article'||n.contentGroup!=='news'||classify(n).primaryRegion!=='ntb'||n.editorial_summary||inputFor(n).length<80||String(n.title||'').length<15){report.skipped++;output.push(n);continue;}
  const cacheKey=crypto.createHash('sha256').update(JSON.stringify(['hub-ai-v1',mode,onlyProvider||'',n.id,n.title,inputFor(n)])).digest('hex');
  const cached=db.prepare('SELECT payload FROM hub_ai_cache WHERE cache_key=?').get(cacheKey);let result;
  if(cached){try{result=JSON.parse(cached.payload);valid(result.payload,n);if(mode==='public'&&result.provider==='cohere')result=null;else report.cached++;}catch{result=null;}}
  if(!result&&attempted<s.batchLimit&&Date.now()<deadline){attempted++;
   for(const id of providers){const p=s.providers[id],fp=fingerprint(id,p),oldFp=crypto.createHash('sha256').update(id+'|'+p.apiKey+'|'+p.model).digest('hex');if(db.prepare('SELECT 1 FROM hub_ai_circuit WHERE fingerprint IN (?,?) AND until_at>?').get(fp,oldFp,now))continue;
    if(db.prepare('SELECT COUNT(*) n FROM hub_ai_attempts WHERE at>=?').get(now-86400000).n>=s.dailyLimit||Date.now()>=deadline)break;
    if(!db.prepare('UPDATE hub_ai_lock SET until_at=? WHERE id=1 AND owner=?').run(Date.now()+120000,owner).changes)break;
    const attempt=db.prepare("INSERT INTO hub_ai_attempts(at,provider,model,status) VALUES(?,?,?,'running')").run(now,id,p.model).lastInsertRowid;
    try{result=await request(id,p,n,{fetchImpl,allowPublic:s.allowPublic,timeout:Math.min(20000,deadline-Date.now()),onPublicOutput});db.prepare("UPDATE hub_ai_attempts SET status='success',http=200,model=? WHERE id=?").run(result.model,attempt);report.attempts.push({provider:id,status:'success',http:200,model:result.model});db.prepare('INSERT OR REPLACE INTO hub_ai_cache VALUES(?,?)').run(cacheKey,JSON.stringify(result));db.prepare('DELETE FROM hub_ai_circuit WHERE fingerprint=?').run(fp);report.processed++;break;}
    catch(e){const http=Number.isInteger(e.http)?e.http:null;const reason=http?'HTTP '+http:['Respons terpotong','JSON tidak valid','Metadata tidak lolos validasi','Respons tidak selesai','Respons terlalu besar'].includes(e.message)||/^Metadata tidak lolos validasi: (Invalid JSON|Invalid field|Invalid length|Invalid category|Invalid tags|Unsupported tag|Unsupported number|Unsafe title|Insufficient grounding)$/.test(e.message)?e.message:'Koneksi/timeout gagal';const cooldown=http===429?e.retry:[401,403,404].includes(http)?3600000:300000;db.prepare("UPDATE hub_ai_attempts SET status='failed',http=?,reason=? WHERE id=?").run(http,reason,attempt);db.prepare('INSERT OR REPLACE INTO hub_ai_circuit VALUES(?,?,?)').run(fp,id,now+cooldown);report.attempts.push({provider:id,status:'failed',http,reason});}
   }if(!result)report.failed++;
  }
  output.push(result?{...n,...result.payload,editorial_category:result.payload.category,original_title:n.original_title||n.title,seo_method:result.provider+'_ntb',enrichment:{provider:result.provider,model:result.model,version:'hub-ai-v1',automated:true}}:n);
 }}finally{db.prepare('DELETE FROM hub_ai_lock WHERE id=1 AND owner=?').run(owner);}
 return {items:output,report};
}
async function models(id,p,{fetchImpl=network}={}){
 const urls={openrouter:'https://openrouter.ai/api/v1/models',groq:'https://api.groq.com/openai/v1/models',cohere:'https://api.cohere.com/v1/models',mistral:'https://api.mistral.ai/v1/models'};
 if(!urls[id]||!p.apiKey)throw Error('Provider atau API key belum tersedia');const r=await fetchImpl(urls[id],{headers:{Authorization:'Bearer '+p.apiKey},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok){r.body?.destroy?.();throw Error('Daftar model HTTP '+r.status);}const raw=await r.text();if(raw.length>2500000)throw Error('Daftar model terlalu besar');const d=JSON.parse(raw);let list=(d.data||d.models||[]).map(m=>m.id||m.name).filter(m=>typeof m==='string'&&/^[a-zA-Z0-9_.:/+-]{1,160}$/.test(m));if(id==='openrouter')list=['openrouter/free',...list.filter(m=>m.endsWith(':free'))];else list=list.filter(m=>!/whisper|tts|orpheus|guard|embed|rerank|voxtral/i.test(m));return [...new Set(list)].sort();
}
module.exports={enrich,request,history,migrate,models,eligible};
