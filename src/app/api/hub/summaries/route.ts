import {NextResponse} from 'next/server';
import type {Client} from '@libsql/client';
import {authenticatedDb,errorJson,invalidMutation,NO_STORE,readJson} from '@/server/hub/security/http';
import {prepareSummarySchema,scanCandidates,runSummaryBatch,summaryStatus,listSummaries,applySummary,summaryMessage,SUMMARY_POLICY} from '@/server/hub/domain/ai-summary';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^(?:legacy-news:)?[0-9a-f-]{36}$/.test(v);
const reply=(value:unknown)=>NextResponse.json(value,{headers:NO_STORE});

async function freshness(db:Client){
  try{const r=(await db.execute("SELECT freshness_hours FROM hub_preferences_v3 WHERE id='owner'")).rows[0];const n=Number(r?.freshness_hours);return Number.isFinite(n)&&n>=1&&n<=168?n:72;}catch{return 72;}
}
async function readiness(db:Client){
  try{
    const policy=(await db.execute("SELECT allow_public,groq_free FROM hub_ai_policy_v2 WHERE id='owner'")).rows[0];
    const keys=(await db.execute("SELECT provider,model,key_ciphertext FROM hub_ai_provider_settings WHERE provider IN ('openrouter','groq')")).rows;
    return {consent:Number(policy?.allow_public)===1,groqFree:Number(policy?.groq_free)===1,keysConfigured:keys.filter(r=>r.key_ciphertext).map(r=>String(r.provider)),quotaPerDay:SUMMARY_POLICY.providerAttemptsPerDay};
  }catch{return {consent:false,groqFree:false,keysConfigured:[],quotaPerDay:SUMMARY_POLICY.providerAttemptsPerDay};}
}
export async function GET(request:Request){
  const a=await authenticatedDb(request);if(a.error)return a.error;
  try{
    const url=new URL(request.url);const status=await summaryStatus(a.db);const view=url.searchParams.get('view');
    if(view==='list')return reply({items:status.ready?await listSummaries(a.db,100):[],ready:status.ready});
    const plan=await scanCandidates(a.db,await freshness(a.db));
    return reply({status,ready:status.ready,plan:{scanned:plan.scanned,aiPending:plan.aiPending,extractivePending:plan.extractivePending,reasons:plan.reasons,estimatedTokensNextRun:plan.estimatedTokensNextRun},policy:SUMMARY_POLICY,ai:await readiness(a.db),publicationEnabled:false});
  }catch{return errorJson('Ringkasan belum dapat dibaca. Teks asli tidak diubah.',503);}
}
export async function POST(request:Request){
  const invalid=invalidMutation(request);if(invalid)return invalid;
  const a=await authenticatedDb(request);if(a.error)return a.error;
  if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='webhub')return errorJson('Ringkasan AI dibatasi Preview webhub.',403);
  try{
    const b=await readJson(request);
    if(b.action==='prepare'){if(b.confirm!=='PREPARE SUMMARIES')return errorJson('Konfirmasi diperlukan.',400);return reply(await prepareSummarySchema(a.db));}
    if(b.action==='batch'){
      const includeEditorial=b.includeExisting===true;
      if(b.confirm!==(includeEditorial?'FORCE SUMMARY':'GENERATE SUMMARIES'))return errorJson('Konfirmasi pembuatan ringkasan diperlukan.',400);
      if(!(await summaryStatus(a.db)).ready)return errorJson('Siapkan tabel ringkasan dahulu.',409);
      const out=await runSummaryBatch(a.db,{maxItems:Number(b.maxItems)||undefined,freshnessHours:await freshness(a.db),master:process.env.HUB_MASTER_KEY,includeEditorial});
      return reply(out);
    }
    if(b.action==='apply'){
      if(b.confirm!=='APPLY SUMMARY')return errorJson('Konfirmasi penerapan diperlukan.',400);
      if(!validId(b.id)||!Number.isInteger(b.version)||Number(b.version)<1)return errorJson('ID/versi tidak valid.',400);
      return reply(await applySummary(a.db,b.id,Number(b.version)));
    }
    return errorJson('Aksi tidak dikenal.',400);
  }catch(e){const code=e instanceof Error?e.message:'';return errorJson(summaryMessage(code),code==='SUMMARY_OUTPUT_UNGROUNDED'?422:409);}
}
