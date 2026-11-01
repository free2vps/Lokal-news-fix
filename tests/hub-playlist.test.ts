import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistId} from '../src/server/hub/domain/operations';

test('playlistId menerima ID langsung maupun alamat YouTube lengkap', () => {
  assert.equal(playlistId('OLT0p76Cd7kYMmbBNlt_TvC4vzjFTMKMNjw'), 'OLT0p76Cd7kYMmbBNlt_TvC4vzjFTMKMNjw');
  assert.equal(playlistId('https://www.youtube.com/playlist?list=PLabcdefghij123456'), 'PLabcdefghij123456');
  assert.equal(playlistId('https://www.youtube.com/watch?v=abc&list=PLzzzzzzzzzz99999&index=2'), 'PLzzzzzzzzzz99999');
});

test('playlistId jatuh ke bawaan bila kosong atau tidak sah — tidak pernah menghasilkan alamat rusak', () => {
  const fallback = 'OLT0p76Cd7kYMmbBNlt_TvC4vzjFTMKMNjw';
  assert.equal(playlistId(undefined), fallback);
  assert.equal(playlistId(''), fallback);
  assert.equal(playlistId('bukan id!!'), fallback);
});
