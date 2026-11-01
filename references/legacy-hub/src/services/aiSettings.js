const fs=require('fs'),path=require('path'),crypto=require('crypto');
const IDS=['openrouter','groq','cohere','mistral'];
const DEFAULTS={openrouter:'openrouter/free',groq:'',cohere:'',mistral:'mistral-small-latest'};
function createStore({dir=path.join(__dirname,'../../data'),env=process.env}={}){
 const file=path.join(dir,'ai-settings.enc.json'),master=path.join(dir,'ai-master.key');
 function key(){fs.mkdirSync(dir,{recursive:true,mode:0o700});if(!fs.existsSync(master)){if(fs.existsSync(file))throw Error('Kunci penyimpanan AI tidak tersedia');try{fs.writeFileSync(master,crypto.randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}}fs.chmodSync(master,0o600);const k=fs.readFileSync(master);if(k.length!==32)throw Error('Kunci penyimpanan AI tidak valid');return k;}
 function write(value){const k=key(),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',k,iv);const body=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);const tmp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';fs.writeFileSync(tmp,JSON.stringify({v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),body:body.toString('base64')}),{mode:0o600});fs.renameSync(tmp,file);fs.chmodSync(file,0o600);}
 function read(){if(!fs.existsSync(file))return null;const k=key(),e=JSON.parse(fs.readFileSync(file,'utf8'));const d=crypto.createDecipheriv('aes-256-gcm',k,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(e.body,'base64')),d.final()]).toString());}
 function initialize(){if(read())return;const providers={};for(const id of IDS){providers[id]={model:env[id.toUpperCase()+'_MODEL']||DEFAULTS[id],apiKey:env[id.toUpperCase()+'_API_KEY']||'',enabled:id==='openrouter'&&!!env.OPENROUTER_API_KEY,freeConfirmed:false};}write({version:1,enabled:false,allowPublic:env.OPENROUTER_ALLOW_PUBLIC_DATA==='true',dailyLimit:20,batchLimit:1,order:IDS,providers});}
 function snapshot(){const s=read();return {...Object.fromEntries(['version','enabled','allowPublic','dailyLimit','batchLimit','order'].map(k=>[k,s[k]])),providers:Object.fromEntries(IDS.map(id=>[id,{model:s.providers[id].model,enabled:s.providers[id].enabled,freeConfirmed:s.providers[id].freeConfirmed,keyConfigured:!!s.providers[id].apiKey,evaluationOnly:id==='cohere'}]))};}
 function update(body){if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Pengaturan AI tidak valid');const s=read();for(const k of Object.keys(body))if(!['enabled','allowPublic','dailyLimit','batchLimit','order','providers'].includes(k))throw Error('Field pengaturan tidak dikenal');
  for(const k of ['enabled','allowPublic'])if(k in body){if(typeof body[k]!=='boolean')throw Error('Status harus boolean');s[k]=body[k];}
  for(const [k,min,max]of [['dailyLimit',1,100],['batchLimit',1,5]])if(k in body){if(!Number.isInteger(body[k])||body[k]<min||body[k]>max)throw Error('Batas pemrosesan tidak valid');s[k]=body[k];}
  if(body.order){if(!Array.isArray(body.order)||body.order.length!==IDS.length||new Set(body.order).size!==IDS.length||body.order.some(x=>!IDS.includes(x)))throw Error('Urutan provider tidak valid');s.order=body.order;}
  if(body.providers){if(typeof body.providers!=='object'||Array.isArray(body.providers))throw Error('Provider tidak valid');for(const [id,p]of Object.entries(body.providers)){if(!IDS.includes(id)||!p||typeof p!=='object'||Array.isArray(p))throw Error('Provider tidak valid');for(const k of Object.keys(p))if(!['model','enabled','apiKey','deleteKey','freeConfirmed'].includes(k))throw Error('Field provider tidak dikenal');const old=s.providers[id];if('model'in p){if(typeof p.model!=='string'||p.model.length>160||p.model&&!/^[a-zA-Z0-9_.:/+-]+$/.test(p.model))throw Error('Model tidak valid');old.model=p.model;}
   for(const k of ['enabled','freeConfirmed'])if(k in p){if(typeof p[k]!=='boolean')throw Error('Status provider tidak valid');old[k]=p[k];}
   if('deleteKey'in p&&typeof p.deleteKey!=='boolean')throw Error('Status hapus tidak valid');if(p.deleteKey){old.apiKey='';old.enabled=false;}
   else if(p.apiKey!==undefined&&p.apiKey!==''){if(typeof p.apiKey!=='string'||p.apiKey.length<16||p.apiKey.length>512||/\s/.test(p.apiKey))throw Error('API key tidak valid');old.apiKey=p.apiKey;}
   if(id==='cohere'&&old.enabled)throw Error('Cohere trial hanya untuk evaluasi; tidak boleh menjadi fallback publik');
   if(old.enabled&&(!old.apiKey||!old.model))throw Error('Provider aktif harus memiliki API key dan model');
   if(id==='openrouter'&&old.model&&old.model!=='openrouter/free'&&!old.model.endsWith(':free'))throw Error('OpenRouter hanya model gratis');
   if(old.enabled&&['groq','mistral'].includes(id)&&!old.freeConfirmed)throw Error('Konfirmasikan akun Free tanpa billing untuk provider ini');
  }}
  if(s.enabled&&(!s.allowPublic||!IDS.some(id=>s.providers[id].enabled)))throw Error('Aktivasi perlu izin cuplikan publik dan minimal satu provider');write(s);return snapshot();
 }
 return {read,initialize,snapshot,update,exists:()=>fs.existsSync(file)};
}
module.exports={createStore,IDS};
