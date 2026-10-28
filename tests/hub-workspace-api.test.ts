import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createClient} from '@libsql/client';import {setupOwner} from '../src/server/hub/security/auth';import {prepareOperationalSchema} from '../src/server/hub/domain/maintenance';import {prepareFeatures} from '../src/server/hub/domain/operations';
test('workspace APIs enforce auth, CSRF, Preview scope and persisted settings without exposing credentials',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'hub-workspace-')),url='file:'+path.join(dir,'test.db'),db=createClient({url});
 const names=['HUB_DATABASE_URL','HUB_ALLOW_LOCAL_DB','VERCEL_ENV','VERCEL_GIT_COMMIT_REF'];const saved=names.map(k=>process.env[k]);
 try{
  await db.executeMultiple(await readFile('db/hub-migrations/001_initial.sql','utf8'));await prepareOperationalSchema(db);await prepareFeatures(db);
  const token='test-setup-token-long-enough-not-real-secret';const setup=await setupOwner(db,{password:'temporary-password-test',token},token);if(!setup.ok)throw Error('fixture');
  process.env.HUB_DATABASE_URL=url;process.env.HUB_ALLOW_LOCAL_DB='true';process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF='webhub';
  const routes=await import('../src/app/api/hub/workspace/route');const origin='http://localhost:3100';
  assert.equal((await routes.GET(new Request(origin+'/api/hub/workspace?kind=settings'))).status,401);
  const cookie='hub_session='+setup.session;const post=(body:unknown,csrf=true)=>new Request(origin+'/api/hub/workspace',{method:'POST',headers:{cookie,'Content-Type':'application/json',...(csrf?{origin,'X-Hub-Request':'1'}:{})},body:JSON.stringify(body)});
  const preferences={freshnessHours:48,retentionDays:30,allowX:false,allowYoutube:false,allowRss:false};
  assert.equal((await routes.POST(post({action:'settings',preferences},false))).status,403);
  assert.equal((await routes.POST(post({action:'settings',preferences}))).status,200);
  const response=await routes.GET(new Request(origin+'/api/hub/workspace?kind=settings',{headers:{cookie}}));const data=await response.json();assert.equal(data.preferences.freshnessHours,48);assert.equal(data.retention.deleted,0);assert.equal(data.schedulerEnabled,false);assert.ok(!JSON.stringify(data).includes(setup.session));
  assert.equal((await routes.POST(post({action:'syncX'}))).status,409); // No network call: consent false.
  const status=await routes.GET(new Request(origin+'/api/hub/workspace?kind=integration',{headers:{cookie}}));assert.equal((await status.json()).publicationEnabled,false);
  assert.equal((await routes.GET(new Request(origin+'/api/hub/workspace?kind=credentials',{headers:{cookie}}))).status,400);
  process.env.VERCEL_ENV='production';assert.equal((await routes.POST(post({action:'settings',preferences}))).status,403);
 }finally{db.close();names.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});await rm(dir,{recursive:true,force:true});}
});
