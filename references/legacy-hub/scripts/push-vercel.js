// Manual, server-side push. Never expose signing secrets to browser code.
require('dotenv').config({quiet:true});
const fs=require('fs'),crypto=require('crypto');
async function main(){
 const secret=process.env.CONTENT_HUB_PUSH_SECRET;
 if(!secret||secret.length<32)throw Error('CONTENT_HUB_PUSH_SECRET minimal 32 karakter');
 const target=new URL(process.env.CONTENT_HUB_PUSH_URL||'');
 // Only Vercel HTTPS endpoints; no redirects or arbitrary/private destinations.
 if(target.protocol!=='https:'||!target.hostname.endsWith('.vercel.app')||target.username||target.password||target.port||target.pathname!=='/api/content-hub/push'||target.search||target.hash)throw Error('Gunakan URL HTTPS *.vercel.app/api/content-hub/push tanpa query');
 const credentials=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../data/credentials.json')));
 const token=process.env.PORTAL_API_TOKEN||credentials.portal;
 const feeds={};
 for(const type of ['recommended','x-trends','youtube-music']){
  const r=await fetch(`http://127.0.0.1:${Number(process.env.PORT)||3000}/api/portal-feed?type=${type}&limit=100`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok)throw Error('Feed lokal '+type+' HTTP '+r.status);
  const raw=await r.text();if(Buffer.byteLength(raw)>3000000)throw Error('Feed lokal terlalu besar');
  const data=JSON.parse(raw);if(!data.ok)throw Error('Feed lokal tidak valid');feeds[type]=data;
 }
 const {db,initDatabase}=require('../src/db/init');initDatabase();
 const enriched=await require('../src/services/aiRouter').enrich(db,feeds.recommended.items);
 feeds.recommended.items=enriched.items;feeds.recommended.enrichmentReport=enriched.report;
 await require('../src/services/aiBridge').assertAiBridge(enriched.items,target.href,{bypass:process.env.VERCEL_AUTOMATION_BYPASS_SECRET});
 console.log('NTB enrichment:',JSON.stringify(enriched.report));
 const raw=JSON.stringify({version:1,feeds});if(Buffer.byteLength(raw)>3000000)throw Error('Payload terlalu besar');
 const timestamp=String(Date.now()),signature='sha256='+crypto.createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
 const response=await fetch(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json','x-hub-timestamp':timestamp,'x-hub-signature':signature,...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET?{'x-vercel-protection-bypass':process.env.VERCEL_AUTOMATION_BYPASS_SECRET}:{})},body:raw});
 const text=await response.text();console.log('Push Vercel HTTP '+response.status);
 if(!(response.headers.get('content-type')||'').includes('application/json'))throw Error('Respons bukan JSON; periksa proteksi Vercel Preview');
 console.log(text.slice(0,8000));if(!response.ok||response.status===207)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
