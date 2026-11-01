const {createStore,IDS}=require('./aiSettings');
const router=require('./aiRouter');
function install(app,db,{locks,csrf,store=createStore()}={}){
 store.initialize();router.migrate(db);
 const candidates=()=>require('./editorial').recommend(db,{limit:100}).items.filter(n=>n.kind==='article'&&n.contentGroup==='news'&&require('./regional').classify(n).primaryRegion==='ntb'&&!n.editorial_summary&&require('./mistralNtb').inputFor(n).length>=80);
 app.use('/api/admin/ai',(req,res,next)=>{res.setHeader('Cache-Control','no-store');return ['GET','HEAD'].includes(req.method)?next():csrf(req,res,next);},require('express-rate-limit').rateLimit({windowMs:60000,limit:15}));
 app.get('/api/admin/ai',(req,res)=>res.json({ok:true,settings:store.snapshot(),...router.history(db),candidates:candidates().slice(0,20).map(n=>({id:n.id,title:n.title,source:n.source_name,publishedAt:n.published_at}))}));
 app.post('/api/admin/ai/settings',(req,res)=>{try{if(locks.size)return res.status(409).json({error:'Tunggu proses yang sedang berjalan sebelum mengubah konfigurasi'});res.json({ok:true,settings:store.update(req.body)});}catch(e){res.status(400).json({error:['Pengaturan AI tidak valid','Kunci penyimpanan AI tidak tersedia'].includes(e.message)?e.message:e.message.length<140?e.message:'Pengaturan tidak dapat disimpan'});}});
 app.post('/api/admin/ai/models',async(req,res)=>{if(!IDS.includes(req.body.provider))return res.status(400).json({error:'Provider tidak valid'});try{const s=store.read();res.json({ok:true,models:await router.models(req.body.provider,s.providers[req.body.provider])});}catch{res.status(400).json({error:'Daftar model tidak tersedia. Periksa API key atau batas provider; model juga dapat diisi manual.'});}});
 app.post('/api/admin/ai/test',async(req,res)=>{
  if(locks.size)return res.status(409).json({error:'Proses lain sedang berjalan'});
  const provider=req.body.provider;if(provider!==undefined&&!IDS.includes(provider))return res.status(400).json({error:'Provider tidak valid'});
  const n=candidates().find(n=>n.id===req.body.articleId);if(!n)return res.status(400).json({error:'Pilih artikel NTB dengan cuplikan cukup dan tanpa edit manual'});
  const s=store.read();if(!s.allowPublic)return res.status(400).json({error:'Setujui pengiriman judul/cuplikan publik lebih dahulu'});
  if(provider&&!router.eligible(provider,s.providers[provider],'evaluation'))return res.status(400).json({error:'API key/model belum lengkap atau akun Free belum dikonfirmasi'});
  locks.add('ai-test');try{
   const r=await router.enrich(db,[n],{store,config:{...s,enabled:true,batchLimit:1},onlyProvider:provider,mode:provider?'evaluation':'public'});const item=r.items[0];res.json({ok:true,report:r.report,summaryUnchanged:item.summary===n.summary,result:item.enrichment?{meta_title:item.meta_title,meta_description:item.meta_description,category:item.editorial_category,provider:item.enrichment.provider,model:item.enrichment.model}:null,note:'Hanya uji metadata. Tidak mengirim artikel ke Supabase/Vercel; bukan bukti E2E HTML.'});
  }catch{res.status(500).json({error:'Pengujian tidak selesai; data asli dipertahankan'});}finally{locks.delete('ai-test');}
 });
 return store;
}
module.exports={install};
