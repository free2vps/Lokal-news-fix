import dns from 'node:dns/promises';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
/** Resolve all addresses, reject nonpublic, pin the actual TLS connection. Never downgrade TLS. */
export async function publicFetch(raw:string,maxBytes=1500000,allowedHosts?:string[]):Promise<string>{
 const u=new URL(raw),host=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||/[\[\]]/.test(host)||/\.(local|internal|localhost)$/.test(host)||host==='localhost'||(allowedHosts&&!allowedHosts.includes(host)))throw Error('NETWORK_BLOCKED');
 const answers=await dns.lookup(host,{all:true});
 if(!answers.length||answers.some(a=>!ipaddr.isValid(a.address)||ipaddr.process(a.address).range()!=='unicast'))throw Error('NETWORK_BLOCKED');
 const answer=answers[0];
 return new Promise((resolve,reject)=>{
  const req=https.get(u,{headers:{'User-Agent':'PortalContentHub/1.0 (+manual metadata sync)','Accept':'application/rss+xml,application/atom+xml,text/xml,text/html;q=0.5'},lookup:((_hostname:unknown,options:any,cb:any)=>options?.all?cb(null,[answer]):cb(null,answer.address,answer.family)) as any},res=>{
   if(res.statusCode!==200){res.destroy();reject(Error('HTTP_'+res.statusCode));return;}
   const chunks:Buffer[]=[];let n=0;
   res.on('data',(chunk:Buffer)=>{n+=chunk.length;if(n>maxBytes){res.destroy(Error('RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
   res.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks).toString('utf8'));});res.on('error',reject);
  });
  const timer=setTimeout(()=>req.destroy(Error('NETWORK_TIMEOUT')),12000);timer.unref();
  req.on('error',e=>{clearTimeout(timer);reject(e);});req.on('close',()=>clearTimeout(timer));
 });
}
export async function checkRobots(raw:string,allowedHosts?:string[]){
 const u=new URL(raw);let body:string;
 try{body=await publicFetch(new URL('/robots.txt',u).href,100000,allowedHosts);}catch(e){if(e instanceof Error&&e.message==='HTTP_404')return;throw Error('ROBOTS_UNAVAILABLE');}
 if(robotsParser(new URL('/robots.txt',u).href,body).isAllowed(u.href,'PortalContentHub')===false)throw Error('ROBOTS_BLOCKED');
}
