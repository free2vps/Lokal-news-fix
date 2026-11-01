const test=require('node:test'),assert=require('node:assert/strict');const Database=require('better-sqlite3');const {enrich}=require('./src/services/mistralNtb');
test('NTB AI disabled: no API calls',async()=>{delete process.env.MISTRAL_NTB_ENABLED;const db=new Database(':memory:');let calls=0;const result=await enrich(db,[{title:'Berita Mataram'}],{fetchImpl:async()=>{calls++;}});assert.equal(calls,0);assert.equal(result.report.enabled,false);db.close();});
test('NTB enrichment cached; Bali and manual edits excluded; API failure preserves content',async()=>{
 process.env.MISTRAL_NTB_ENABLED='true';process.env.MISTRAL_API_KEY='test-not-real';
 const db=new Database(':memory:');let calls=0;
 const summary='Pemerintah Mataram membuka program pelatihan bagi warga. Pendaftaran program pelatihan tersedia melalui pengumuman resmi pemerintah Mataram.';
 const n={id:'ntb',kind:'article',contentGroup:'news',title:'Program pelatihan warga Mataram dibuka',source_description:summary};
 const payload={title:n.title,summary,meta_title:n.title,meta_description:summary.slice(0,150),key_points:[],section_headings:[],tags:['Mataram'],category:'Pendidikan'};
 const fetchImpl=async()=>{calls++;return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(payload)}}]})};};
 const first=await enrich(db,[n,{...n,id:'bali',title:'Program pelatihan warga Denpasar dibuka',source_description:'Pelatihan Denpasar. '.repeat(50)},{...n,id:'manual',editorial_summary:'Editor'}],{fetchImpl});assert.equal(first.report.processed,1);assert.equal(first.items[0].summary,n.summary);assert.equal(first.items[0].editorial_category,'Pendidikan');assert.equal(calls,1);assert.equal(first.items[0].seo_method,'mistral_ntb');
 const again=await enrich(db,[n],{fetchImpl});assert.equal(again.report.cached,1);assert.equal(calls,1);
 const failed=await enrich(db,[{...n,id:'fail'}],{fetchImpl:async()=>{throw Error('network');}});assert.equal(failed.report.failed,1);assert.equal(failed.items[0].summary_method,undefined);db.close();delete process.env.MISTRAL_NTB_ENABLED;delete process.env.MISTRAL_API_KEY;
});
