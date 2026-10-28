import test from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '../src/lib/types';
import { feedIsExhausted, appendUniqueArticles, validFeedResponse } from '../src/lib/feed-pagination';
const a = (id:number) => ({ id,slug:`berita-${id}`,title:'Berita',category:'Umum',source_name:'Penerbit',published_at:'2026-10-27T01:00:00Z' } as Article);
test('six news items without entertainment must not stop pagination',()=>{
 assert.equal(feedIsExhausted(Array.from({length:6},(_,i)=>a(i))),false);
 assert.equal(feedIsExhausted([a(1)]),false); assert.equal(feedIsExhausted([]),true);
});
test('pagination deduplicates initial and subsequently fetched articles',()=>{
 assert.deepEqual(appendUniqueArticles([a(3)],[a(1),a(3),a(4)],[1,2]).map(a=>a.id),[3,4]);
});
test('malformed feed is rejected rather than replacing valid content',()=>{
 assert.equal(validFeedResponse({error:'unavailable'}),false);
 assert.equal(validFeedResponse([{}]),false);assert.equal(validFeedResponse([a(1)]),true);
});
