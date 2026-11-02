import dns from 'node:dns/promises';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
/** Resolve all addresses, reject nonpublic, pin the actual TLS connection. Never downgrade TLS. */
/**
 * Alasan `hops`: banyak situs mengalihkan alamat secara wajar — menambah garis miring
 * (`/feed` → `/feed/`), memindahkan `http` ke `https`, atau mengarahkan ke alamat kanonis.
 * Sebelumnya SEMUA pengalihan dijawab sebagai galat ("HTTP 301"), sehingga sumber yang
 * sebenarnya sehat ditolak dengan pesan yang membingungkan.
 *
 * Batas keamanan tetap dipertahankan: hanya https, hanya host yang sama, maksimal 2 lompatan,
 * dan setiap lompatan diperiksa ulang DNS-nya supaya tidak bisa dipakai menembus jaringan lokal.
 */
export async function publicFetch(raw:string,maxBytes=1500000,allowedHosts?:string[],hops=0):Promise<string>{
 const u=new URL(raw),host=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||/[\[\]]/.test(host)||/\.(local|internal|localhost)$/.test(host)||host==='localhost'||(allowedHosts&&!allowedHosts.includes(host)))throw Error('NETWORK_BLOCKED');
 const answers=await dns.lookup(host,{all:true});
 if(!answers.length||answers.some(a=>!ipaddr.isValid(a.address)||ipaddr.process(a.address).range()!=='unicast'))throw Error('NETWORK_BLOCKED');
 const answer=answers[0];
 return new Promise((resolve,reject)=>{
  const req=https.get(u,{headers:{'User-Agent':'PortalContentHub/1.0 (+manual metadata sync)','Accept':'application/rss+xml,application/atom+xml,text/xml,text/html;q=0.5'},lookup:((_hostname:unknown,options:any,cb:any)=>options?.all?cb(null,[answer]):cb(null,answer.address,answer.family)) as any},res=>{
   const code=Number(res.statusCode);
   if(code>=300&&code<400&&res.headers.location){
     res.destroy();
     if(hops>=2){reject(Error('HTTP_'+code));return;}
     let next:URL;
     try{next=new URL(String(res.headers.location),u);}catch{reject(Error('HTTP_'+code));return;}
     // Hanya https dan host yang sama — mencegah pengalihan ke alamat dalam jaringan.
     if(next.protocol!=='https:'||next.hostname.toLowerCase()!==host){reject(Error('HTTP_'+code));return;}
     clearTimeout(timer);
     publicFetch(next.href,maxBytes,allowedHosts,hops+1).then(resolve,reject);
     return;
   }
   if(code!==200){res.destroy();reject(Error('HTTP_'+code));return;}
   const chunks:Buffer[]=[];let n=0;
   res.on('data',(chunk:Buffer)=>{n+=chunk.length;if(n>maxBytes){res.destroy(Error('RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
   res.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks).toString('utf8'));});res.on('error',reject);
  });
  // Batas waktu per permintaan. Situs pemerintah daerah sering lambat: prokopim.sumbawabaratkab.go.id
  // butuh 11–20 detik, sehingga batas 12 detik membuatnya SELALU gagal (NETWORK_TIMEOUT) padahal
  // isinya bisa dibaca. Dinaikkan ke 30 detik dan bisa diatur lewat HUB_FETCH_TIMEOUT_MS.
  const timeoutMs=Math.min(60000,Math.max(5000,Number(process.env.HUB_FETCH_TIMEOUT_MS??30000)||30000));
  const timer=setTimeout(()=>req.destroy(Error('NETWORK_TIMEOUT')),timeoutMs);timer.unref();
  req.on('error',e=>{clearTimeout(timer);reject(e);});req.on('close',()=>clearTimeout(timer));
 });
}
export async function checkRobots(raw:string,allowedHosts?:string[]){
 const u=new URL(raw);let body:string;
 try{body=await publicFetch(new URL('/robots.txt',u).href,100000,allowedHosts);}catch(e){if(e instanceof Error&&e.message==='HTTP_404')return;throw Error('ROBOTS_UNAVAILABLE');}
 if(robotsParser(new URL('/robots.txt',u).href,body).isAllowed(u.href,'PortalContentHub')===false)throw Error('ROBOTS_BLOCKED');
}
