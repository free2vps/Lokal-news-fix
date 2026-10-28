// Explicit live diagnostic only. Never run automatically from the test suite.
// Reads the same encrypted dashboard configuration as the regular push path.
require('dotenv').config({quiet:true});
const {db}=require('../src/db/init');
const {createStore}=require('../src/services/aiSettings');
(async()=>{
 const store=createStore();store.initialize();const s=store.read();
 if(!s.allowPublic)throw Error('Setujui pengiriman cuplikan publik melalui dashboard lebih dahulu');
 const {classify}=require('../src/services/regional'),{inputFor}=require('../src/services/mistralNtb');
 const article=require('../src/services/editorial').recommend(db,{limit:100}).items.find(n=>n.kind==='article'&&n.contentGroup==='news'&&classify(n).primaryRegion==='ntb'&&!n.editorial_summary&&inputFor(n).length>=80&&(!process.argv[2]||n.id===process.argv[2]));
 if(!article)throw Error('Tidak ada kandidat NTB yang memenuhi syarat');
 const r=await require('../src/services/aiRouter').enrich(db,[article],{store,config:{...s,enabled:true,batchLimit:1}});
 const item=r.items[0];console.log(JSON.stringify({report:r.report,summaryUnchanged:item.summary===article.summary,result:item.enrichment?{meta_title:item.meta_title,meta_description:item.meta_description,provider:item.enrichment.provider,model:item.enrichment.model}:null,note:'Uji metadata saja; tidak ada push atau verifikasi HTML.'}));
})().catch(()=>{console.error('Diagnostik belum selesai. Periksa konfigurasi/cooldown di dashboard; secret dan respons mentah tidak dicetak.');process.exitCode=1;}).finally(()=>db.close());
