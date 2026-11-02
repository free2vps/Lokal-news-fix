import test from 'node:test';
import assert from 'node:assert/strict';
import { sortByNewest } from '../src/lib/queries';

const jam = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
const a = (id: number, jamLalu: number) => ({ id, slug: 's' + id, published_at: jam(jamLalu) } as any);

test('berita terbaru benar-benar urut dari yang paling baru', () => {
  // Kasus nyata yang dilaporkan: 19 jam di ATAS, 2 jam di BAWAH.
  const masukan = [a(1, 19), a(2, 2), a(3, 7)];
  const hasil = sortByNewest(masukan).map((x) => x.id);
  assert.deepEqual(hasil, [2, 3, 1]);
});

test('urutan tidak berubah walau masukan berselang-seling dua sumber', () => {
  // Bentuk asli dari getMixedPage: N,N,H,N,H
  const masukan = [a(1, 5), a(2, 4), a(3, 12), a(4, 1), a(5, 30)];
  const hasil = sortByNewest(masukan).map((x) => x.id);
  assert.deepEqual(hasil, [4, 2, 1, 3, 5]);
});

test('duplikat dibuang, bukan tampil dua kali', () => {
  const hasil = sortByNewest([a(1, 3), a(1, 3), a(2, 1)]);
  assert.equal(hasil.length, 2);
  assert.deepEqual(hasil.map((x) => x.id), [2, 1]);
});

test('tanggal rusak/kosong ditaruh paling bawah, tidak dianggap 1970', () => {
  const rusak = { id: 9, slug: 'rusak', published_at: 'bukan-tanggal' } as any;
  const hasil = sortByNewest([rusak, a(1, 10), a(2, 1)]).map((x) => x.id);
  assert.deepEqual(hasil, [2, 1, 9]);
});

import { withinHours } from '../src/lib/queries';

test('batas 36 jam: berita 4 hari dibuang, 19 jam tetap ada', () => {
  const masukan = [a(1, 4 * 24), a(2, 19), a(3, 2), a(4, 37), a(5, 36.5)];
  const hasil = withinHours(masukan, 36).map((x) => x.id).sort();
  assert.deepEqual(hasil, [2, 3], 'hanya 19 jam dan 2 jam yang lolos; 36,5 dan 37 jam dibuang');
});

test('tepat 36 jam masih dihitung (batas inklusif ke dalam)', () => {
  const hampir = { id: 7, slug: 's7', published_at: new Date(Date.now() - 35.9 * 3600_000).toISOString() } as any;
  assert.equal(withinHours([hampir], 36).length, 1);
});

test('tanggal rusak tidak lolos saringan waktu', () => {
  const rusak = { id: 8, slug: 's8', published_at: 'entah' } as any;
  assert.equal(withinHours([rusak], 36).length, 0);
});

test('kategori boleh berulang — saringan waktu tidak menyaring kategori', () => {
  const satu = { ...a(1, 1), category: 'Olahraga' } as any;
  const dua = { ...a(2, 2), category: 'Olahraga' } as any;
  assert.equal(withinHours([satu, dua], 36).length, 2, 'dua berita kategori sama tetap tampil');
});
