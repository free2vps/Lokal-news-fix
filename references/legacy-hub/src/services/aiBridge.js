async function assertAiBridge(items,target,{bypass,fetchImpl=(u,o)=>require('../utils/network').safeFetch(u,o)}={}){
 if(!items.some(n=>n.enrichment?.provider==='groq'))return;
 const url=new URL(target);if(url.protocol!=='https:'||!url.hostname.endsWith('.vercel.app')||url.username||url.password||url.port)throw Error('Target bridge tidak valid');url.pathname='/api/content-hub';url.search='?capabilities=ai-seo-v1';url.hash='';
 const r=await fetchImpl(url.href,{redirect:'error',timeout:15000,signal:AbortSignal.timeout(15000),headers:bypass?{'x-vercel-protection-bypass':bypass}:{}});
 if(!r.ok)throw Error('Bridge Groq belum dapat diverifikasi; push dibatalkan');const raw=await r.text();if(raw.length>3000000)throw Error('Respons bridge terlalu besar');let p;try{p=JSON.parse(raw);}catch{throw Error('Respons bridge tidak valid');}
 if(p?.ok!==true||!Array.isArray(p.capabilities?.aiMetadataProviders)||!p.capabilities.aiMetadataProviders.includes('groq'))throw Error('Preview belum mendukung metadata Groq. Deploy paket bridge pada branch integrasi sebelum push.');
}
module.exports={assertAiBridge};
