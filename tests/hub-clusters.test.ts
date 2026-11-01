import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterArticles, measure, tokenize, type ClusterItem} from '../src/lib/clusters';

const now = new Date().toISOString();
const A: ClusterItem = {id:'a', source:'suarantb.com', title:'Terduga Bandar Sabu di Sumbawa Ditangkap Bersama Pacarnya, 107,53 Gram Sabu Disita', publishedAt: now};
const B: ClusterItem = {id:'b', source:'radarlombok.co.id', title:'Diduga Bandar, Pasangan Kekasih Dibekuk Bersama 107 Gram Sabu', publishedAt: now};
const C: ClusterItem = {id:'c', source:'nusabali.com', title:'Enam Emas dari Malaysia, Atlet Selam Muda Buleleng Bersinar', publishedAt: now};
const D: ClusterItem = {id:'d', source:'balipuspanews.com', title:'17 Medali Dipersembahkan Atlet Selam Buleleng SEA Finswimming Championship 2026', publishedAt: now};

test('peristiwa sama dari dua penerbit berbeda menjadi satu klaster lintas-sumber', () => {
  const cl = clusterArticles([A, B, C, D], {threshold: 0.24});
  const sabu = cl.find((c) => c.members.some((m) => m.id === 'a'))!;
  assert.ok(sabu, 'klaster sabu harus terbentuk');
  assert.equal(sabu.crossSource, true);
  assert.equal(sabu.sources.length, 2);
});

test('dua berita berbeda tidak dipaksa satu klaster', () => {
  const cl = clusterArticles([A, C], {threshold: 0.24});
  assert.equal(cl.length, 0, 'sabu vs atlet selam tidak boleh bergabung');
});

test('satu penerbit menulis dua kali BUKAN klaster liputan', () => {
  const e: ClusterItem = {...A, id: 'e'};
  const cl = clusterArticles([A, e], {threshold: 0.24});
  assert.equal(cl.length, 1);
  assert.equal(cl[0].crossSource, false, 'harus ditandai bukan lintas-sumber');
});

test('artikel di luar jendela waktu tidak ikut diklasterkan', () => {
  const lama: ClusterItem = {...B, id: 'lama', publishedAt: new Date(Date.now() - 10 * 86400_000).toISOString()};
  const cl = clusterArticles([A, lama], {threshold: 0.24, windowHours: 72});
  assert.equal(cl.length, 0);
});

test('measure menghitung cakupan dengan benar', () => {
  const m = measure([A, B, C, D], 0.24);
  assert.equal(m.articles, 4);
  assert.ok(m.crossSourceClusters >= 1);
  assert.equal(m.articlesInCrossSource, 2 * m.crossSourceClusters);
  assert.ok(m.coveragePct >= 0 && m.coveragePct <= 100);
});

test('tokenize membuang kata sambung dan angka', () => {
  const t = tokenize('Bupati Dompu dan 2026 yang di');
  assert.ok(!t.includes('dan'));
  assert.ok(!t.includes('yang'));
  assert.ok(!t.includes('2026'));
  assert.ok(t.includes('bupati'));
});
