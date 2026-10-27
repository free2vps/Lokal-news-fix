import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'crypto';
import {verifyPush,pushLoader} from '../src/lib/content-hub/push';
const secret='s'.repeat(48),now=Date.now(),ts=String(now),raw=JSON.stringify({version:1,feeds:{recommended:{ok:true,items:[]},'x-trends':{ok:true,data:{}},'youtube-music':{ok:true,data:{}}}});
const sign=(s:string)=>'sha256='+createHmac('sha256',secret).update(ts+'.'+s).digest('hex');
test('signed body accepted; altered body, wrong secret and expired signature rejected',()=>{assert.ok(verifyPush(raw,ts,sign(raw),secret,now));assert.equal(verifyPush(raw+' ',ts,sign(raw),secret,now),false);assert.equal(verifyPush(raw,ts,sign(raw),'x'.repeat(48),now),false);assert.equal(verifyPush(raw,ts,sign(raw),secret,now+300001),false);assert.equal(verifyPush(raw,ts,null,secret,now),false);});
test('payload contract and candidate limit',async()=>{assert.deepEqual((await pushLoader(raw)('recommended')).items,[]);assert.throws(()=>pushLoader('{}'));assert.throws(()=>pushLoader(raw.replace('"items":[]','"items":'+JSON.stringify(Array(101).fill({})))));});
