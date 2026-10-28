import test from 'node:test';import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {createClient} from '@libsql/client';
import {accessStatus,workspaceFailure} from '../src/server/hub/domain/access-status';
import {AccessPanel} from '../src/components/hub/HubModules';
test('step1 friendly errors distinguish consent, robots, HTTP and unknown errors without leaking raw errors',()=>{
 assert.ok(workspaceFailure('ACCESS_NOT_CONFIRMED').error.includes('Buka Pengaturan'));
 assert.ok(workspaceFailure('ROBOTS_BLOCKED').error.includes('robots.txt'));
 assert.ok(workspaceFailure('HTTP_403').error.includes('403'));
 const r=workspaceFailure('SECRET_MESSAGE_NOT_FOR_BROWSER');assert.equal(r.code,'SYNC_FAILED');assert.ok(!r.error.includes('SECRET_MESSAGE'));assert.equal(r.dataPreserved,true);
});
test('step1 missing schema gives unknown consent, no fake last attempt and no schema mutation',async()=>{const db=createClient({url:'file::memory:'});try{const s=await accessStatus(db) as any;assert.equal(s.schemaReady,false);assert.equal(s.x.allowed,null);assert.equal(s.youtube.allowed,null);assert.equal(s.x.lastAttempt,null);assert.equal((await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.length,0);}finally{db.close();}});
test('step1 panel separates app consent, access attempt and dataset freshness; settings CTA is present',()=>{
 const html=renderToStaticMarkup(React.createElement(AccessPanel,{kind:'x',error:'',status:{schemaReady:true,x:{allowed:false,lastAttempt:null},youtube:{allowed:true,lastAttempt:null}},onOpenSettings:()=>{}}));
 assert.ok(html.includes('Belum diaktifkan'));assert.ok(html.includes('Buka Pengaturan'));assert.ok(html.includes('Belum ada percobaan manual'));assert.ok(html.includes('Kesegaran data ditampilkan terpisah'));assert.ok(!html.includes('ACCESS_NOT_CONFIRMED'));
});
