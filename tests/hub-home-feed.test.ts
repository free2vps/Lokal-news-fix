import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeFeed, needsLatestFill, mergeTrends} from '../src/lib/feed-merge';
import type {Article} from '../src/lib/types';

const art = (id: string, daysAgo: number, extra: Partial<Article> = {}) => ({
  id, slug: 'slug-' + id, title: 'Judul ' + id, source_url: 'https://contoh.example.org/' + id,
  published_at: new Date(Date.UTC(2026, 9, 30 - daysAgo, 5, 0, 0)).toISOString(), ...extra,
} as unknown as Article);

test('beranda: artikel pilihan Hub dipakai lebih dulu dan urutannya dipertahankan', () => {
  const hub = [art('h1', 0), art('h2', 1)];
  const latest = [art('n1', 0), art('h1', 0), art('n2', 2)];
  const out = mergeFeed(hub, latest, 4);
  assert.deepEqual(out.map(a => a.id), ['h1', 'h2', 'n1', 'n2']);
});

test('beranda: snapshot Hub kosong tetap menampilkan berita terbaru (tidak kosong / tidak dikarang)', () => {
  const latest = [art('n1', 0), art('n2', 1), art('n3', 2)];
  const out = mergeFeed([], latest, 2);
  assert.deepEqual(out.map(a => a.id), ['n1', 'n2'], 'berita terbaru yang benar-benar ada dipakai');
  assert.equal(needsLatestFill([], 2), true);
  assert.equal(needsLatestFill([art('h1', 1)], 2), true);
  assert.equal(needsLatestFill([art('h1', 1), art('h2', 1)], 2), false);
});

test('beranda: tidak ada duplikat walaupun id/slug/source_url berbeda bentuknya', () => {
  const dupBySlug = art('x', 0, {slug: 'same-slug'});
  const dupByUrl = art('y', 0, {slug: 'other', source_url: 'https://sama.example.org/a'});
  const hub = [dupBySlug, dupByUrl];
  const latest = [art('z', 0, {slug: 'same-slug'}), art('w', 0, {slug: 'q', source_url: 'https://sama.example.org/a'}), art('n', 1)];
  const out = mergeFeed(hub, latest, 5);
  assert.deepEqual(out.map(a => a.id), ['x', 'y', 'n']);
});

test('beranda: paginasi offset tetap konsisten setelah penggabungan', () => {
  const hub = [art('h1', 0), art('h2', 1)];
  const latest = [art('h1', 0), art('n1', 2), art('n2', 3), art('n3', 4)];
  assert.deepEqual(mergeFeed(hub, latest, 2, 0).map(a => a.id), ['h1', 'h2']);
  assert.deepEqual(mergeFeed(hub, latest, 2, 2).map(a => a.id), ['n1', 'n2']);
  assert.deepEqual(mergeFeed(hub, latest, 2, 4).map(a => a.id), ['n3']);
  assert.deepEqual(mergeFeed(hub, latest, 4, 9), [], 'offset melewati data → daftar kosong, bukan error');
});

test('tren: snapshot Hub (X/YouTube) tampil walau flag Hub mati, topik Google tetap ada', () => {
  const hub = [
    {platform: 'x_t24', kind: 'topic', title: '#JAEM', rank: 1},
    {platform: 'yt_feed', kind: 'video', title: 'Andien - Naksir', rank: 1},
  ];
  const rows = [
    {platform: 'google', kind: 'topic', title: 'sufmi dasco ahmad', rank: 1},
    {platform: 'x_t24', kind: 'topic', title: '#jaem', rank: 9}, // duplikat (beda kapital)
  ];
  const out = mergeTrends(hub, rows);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(t => t.title), ['#JAEM', 'Andien - Naksir', 'sufmi dasco ahmad']);
  assert.equal(out.filter(t => (t as {kind?: string}).kind === 'video').length, 1, 'panel Video punya isi');
});

test('tren: bila snapshot Hub kosong, perilaku lama dipertahankan', () => {
  const rows = [{platform: 'google', kind: 'topic', title: 'topik a', rank: 1}];
  assert.deepEqual(mergeTrends([], rows).map(t => t.title), ['topik a']);
  assert.deepEqual(mergeTrends([], []), []);
});
