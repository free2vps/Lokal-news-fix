// Additive, manual source registration. Does not collect articles or push data.
require('dotenv').config({quiet:true});const {safeFetch}=require('../src/utils/network');const Parser=require('rss-parser');const {db,initDatabase}=require('../src/db/init');
(async()=>{initDatabase();for(const s of [{id:'antara-bali-regional',name:'ANTARA Bali',url:'https://bali.antaranews.com/rss/terkini.xml',region:'Bali'},{id:'antara-ntt-regional',name:'ANTARA NTT',url:'https://kupang.antaranews.com/rss/terkini.xml',region:'NTT'}]){
 const response=await safeFetch(s.url,{timeout:12000});if(!response.ok)throw Error('Feed HTTP '+response.status);
 const parsed=await new Parser().parseString(await response.text());const fresh=parsed.items.filter(i=>Number.isFinite(Date.parse(i.isoDate||i.pubDate))&&Date.now()-Date.parse(i.isoDate||i.pubDate)<72*3600000&&Date.parse(i.isoDate||i.pubDate)<=Date.now()+300000);
 if(!fresh.length)throw Error('Tidak ada tanggal artikel segar yang valid');
 if(!db.prepare('SELECT id FROM rss_sources WHERE feed_url=?').get(s.url))db.prepare('INSERT INTO rss_sources(id,name,feed_url,publisher,category,region,is_active,status) VALUES(?,?,?,?,?,?,?,?)').run(s.id,s.name,s.url,'ANTARA','Umum',s.region,1,'UNTESTED');
 console.log(JSON.stringify({name:s.name,feedValidation:'HTTP 200 + RSS parsed',freshItems:fresh.length,registered:true,articlesCollected:0}));
}db.close();})().catch(e=>{console.error(e.message);db.close();process.exitCode=1;});
