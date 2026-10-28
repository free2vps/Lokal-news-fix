import test from 'node:test';
import assert from 'node:assert/strict';
import {detectMixSubtype,selectDiverse,mixPolicySummary,type SelectionCandidate} from '../src/server/hub/domain/variety';
import {rankCandidates} from '../src/server/hub/domain/recommendations';
import {classifyContent} from '../src/server/hub/domain/content-profile';

const cand=(id:string,extra:Partial<SelectionCandidate>={}):SelectionCandidate=>({id,score:60,group:'news',regionKind:'regional',mix:null,mixRiskFlagged:false,...extra});
const mix=(id:string,sub:SelectionCandidate['mix'],extra:Partial<SelectionCandidate>={})=>cand(id,{score:50,group:'entertainment',regionKind:'national',mix:sub,...extra});
const fill=(n:number,prefix='r')=>Array.from({length:n},(_,i)=>cand(prefix+String(i).padStart(3,'0'),{score:100-i}));

test('stage3 mix classification is metadata-only and conservative',()=>{
  assert.equal(detectMixSubtype('Drakor terbaru',''),'drakor');
  assert.equal(detectMixSubtype('Sinopsis drama Korea Selatan',''),'drakor');
  assert.equal(detectMixSubtype('Drama Tiongkok pecahkan rekor',''),'dracin');
  assert.equal(detectMixSubtype('Audisi trainee agensi K-pop',''),'idol_group');
  assert.equal(detectMixSubtype('Boy group Indonesia debut',''),'idol_group');
  assert.equal(detectMixSubtype('Presiden Korea Selatan bertemu menteri',''),null);
  assert.equal(detectMixSubtype('Ekonomi Tiongkok melambat',''),null);
  assert.equal(detectMixSubtype('Harga cabai di Lombok',''),null);
  assert.equal(detectMixSubtype('',''),null);
});

test('stage3 combined drakor/dracin/idol share stays within 5-10% target and 10% cap',()=>{
  const pool=[...fill(100),...Array.from({length:10},(_,i)=>mix('m'+i,i%3===0?'drakor':i%3===1?'dracin':'idol_group'))];
  const r=selectDiverse(pool,50);
  assert.equal(r.items.length,50);
  assert.equal(r.mix.count,4);
  assert.ok(r.mix.count>=3&&r.mix.count<=5);
  assert.ok(r.mix.share>=0.05&&r.mix.share<=0.10);
  assert.equal(r.mix.withinTargetShare,true);
  assert.equal(mixPolicySummary().quotaGuaranteed,false);
  assert.equal(mixPolicySummary().publicationEnabled,false);
});

test('stage3 rotates subtypes so one category cannot fill the mix share',()=>{
  const pool=[...fill(60),...Array.from({length:12},(_,i)=>mix('d'+i,'drakor',{score:99})),mix('idol1','idol_group',{score:10})];
  const r=selectDiverse(pool,50);
  assert.equal(r.mix.count,4);
  assert.ok(Object.keys(r.mix.subtypesUsed).length>=2);
  assert.equal(r.mix.subtypesUsed.dracin,undefined);
});

test('stage3 missing supply shortens nothing and never fabricates filler content',()=>{
  const regional=fill(30);
  const r=selectDiverse([...regional,mix('only','drakor')],50);
  assert.equal(r.mix.count,1);
  assert.equal(r.items.length,31);
  assert.ok(r.mix.share<0.05);
  assert.ok(r.mix.shortfall);
  assert.ok(r.items.every(i=>i.id==='only'||i.id.startsWith('r')));
  assert.equal(new Set(r.items.map(i=>i.id)).size,r.items.length);
  assert.equal(selectDiverse(fill(30),50).mix.count,0);
  assert.equal(selectDiverse([],50).items.length,0);
});

test('stage3 risk-flagged mix candidates are set aside, not auto-approved',()=>{
  const pool=[...fill(40),mix('bad','dracin',{mixRiskFlagged:true}),mix('ok','dracin')];
  const r=selectDiverse(pool,50);
  assert.equal(r.mix.available,1);
  assert.equal(r.mix.excludedRiskFlagged,1);
  assert.deepEqual(r.items.map(i=>i.id).filter(id=>id==='bad'),[]);
  assert.ok(r.items.some(i=>i.id==='ok'));
});

test('stage3 non-regional total including mix stays at or below 20% of the real list',()=>{
  const regional=fill(20);
  const national=Array.from({length:20},(_,i)=>cand('n'+String(i).padStart(2,'0'),{regionKind:'national',score:90-i}));
  const mixes=Array.from({length:8},(_,i)=>mix('x'+i,i%2?'drakor':'dracin'));
  const r=selectDiverse([...regional,...national,...mixes],50);
  const non=r.items.filter(i=>i.regionKind!=='regional').length;
  assert.ok(non/r.items.length<=0.2+1e-9);
  assert.ok(r.items.filter(i=>i.mix).length/r.items.length<=0.1+1e-9);
  assert.equal(r.items[0].mix,null);
});

test('stage3 selection is deterministic and excludes duplicates of the same item',()=>{
  const pool=[...fill(20),mix('a','drakor'),mix('b','dracin')];
  const one=selectDiverse(pool,50).items.map(i=>i.id);
  const two=selectDiverse([...pool].reverse(),50).items.map(i=>i.id);
  assert.deepEqual(one,two);
});

test('stage3 recommendations include non-regional entertainment but never publish it',()=>{
  const now=Date.parse('2026-10-28T12:00:00Z');
  const row=(id:string,title:string,extra:Record<string,unknown>={})=>({id,source_title:title,source_snippet:'',source_published_at:'2026-10-28T10:00:00Z',original_url:'https://example.org/'+id,review_state:'pending_review',...extra});
  const regional=Array.from({length:60},(_,i)=>row('r'+String(i).padStart(2,'0'),i%3===0?'Pendidikan Lombok':'Ekonomi Mataram'));
  const rows=[...regional,row('5','Sinopsis drama Korea terbaru'),row('6','Drama Tiongkok populer'),row('7','Boy group baru debut'),
    row('8','Topik tanpa wilayah'),row('9','Nasional Indonesia anggaran')];
  const r=rankCandidates(rows,72,now);
  const ids=r.items.map(i=>i.id);
  assert.ok(ids.includes('5')&&ids.includes('6')&&ids.includes('7'));
  assert.equal(ids.includes('8'),false);
  assert.equal(r.policy.algorithm,'deterministic_not_ai');
  assert.equal(r.policy.publicationEnabled,false);
  assert.equal(r.policy.mixQuotaGuaranteed,false);
  assert.ok(r.mix.count<=Math.floor(r.items.length*0.1));
  assert.ok(String((r.items.filter(i=>i.id==='5')[0] as any).mix.label).includes('Drakor'));
  const flagged=rankCandidates(rows.map(x=>x.id==='5'?{...x,profile_json:JSON.stringify({risk:{status:'needs_review'}})}:x),72,now);
  assert.equal(flagged.items.some(i=>i.id==='5'),false);
  assert.ok(flagged.mix.excludedRiskFlagged>=1);
});

test('stage3 profile rules recognise the new entertainment categories without changing safety labels',()=>{
  const p=classifyContent({id:'a',version:1,source_id:'s',source_name:'Contoh',original_url:'https://example.org/a',source_title:'Drakor Korea terbaru tayang','source_snippet':'Sinopsis singkat drama Korea.','source_published_at':'2026-10-28T10:00:00Z',source_date_raw:'2026-10-28T10:00:00Z',rights_status:'metadata_ok'});
  assert.equal(p.method,'rules_v2_not_ai');
  assert.ok(p.topics.includes('drakor'));
  assert.equal(p.contentGroup,'entertainment');
  assert.equal(p.risk.familySafety,'not_verified');
  assert.equal(p.risk.status,'not_assessed');
  assert.ok(p.audienceRelevance['15-24']>0);
});
