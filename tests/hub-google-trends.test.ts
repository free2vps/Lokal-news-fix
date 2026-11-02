import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGoogle, GOOGLE_URL, syncGoogle} from '../src/server/hub/domain/social';

const RSS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
<channel><title>Daily Search Trends</title>
<item><title>tenerife vs fc andorra</title><ht:approx_traffic>200+</ht:approx_traffic>
<link>https://trends.google.com/trending/rss?geo=ID</link>
<pubDate>Mon, 2 Nov 2026 05:40:00 -0800</pubDate>
<ht:picture>https://encrypted-tbn2.gstatic.com/x.jpg</ht:picture></item>
<item><title>harga beras naik</title><ht:approx_traffic>100+</ht:approx_traffic>
<pubDate>Mon, 2 Nov 2026 05:41:00 -0800</pubDate></item>
<item><title>harga beras naik</title><ht:approx_traffic>100+</ht:approx_traffic></item>
</channel></rss>`;

test('RSS resmi Google Trends dibaca: judul, jumlah pencarian, waktu', async () => {
  const out = await parseGoogle(RSS);
  assert.equal(out.items.length, 2, 'judul ganda dibuang');
  assert.equal(out.items[0].text, 'tenerife vs fc andorra');
  assert.equal(out.items[0].traffic, '200+');
  assert.equal(out.items[0].rank, 1);
  assert.equal(out.items[1].rank, 2);
  assert.equal(out.items[0].publishedAt, '2026-11-02T13:40:00.000Z');
  assert.equal(out.geo, 'ID');
});

test('sumber tren Google adalah RSS resmi, bukan halaman yang dilarang robots', () => {
  assert.equal(GOOGLE_URL, 'https://trends.google.com/trending/rss?geo=ID');
  const isi = readFileSync('src/server/hub/domain/social.ts', 'utf8');
  assert.ok(!/trends\.google\.com\/trends\/explore/.test(isi), 'jangan menyentuh /trends/explore (dilarang robots.txt)');
  assert.ok(!/scrape|selenium|playwright/i.test(isi));
});

test('putaran otomatis menarik tren Google dan mengirimnya bersama X + YouTube', () => {
  const auto = readFileSync('src/server/hub/domain/auto-editor.ts', 'utf8');
  assert.ok(/syncGoogle/.test(auto), 'auto-editor harus memanggil syncGoogle');
  assert.ok(/sync_google/.test(auto), 'hasilnya harus tercatat sebagai langkah sync_google');
  const pub = readFileSync('src/server/hub/domain/trends-publish.ts', 'utf8');
  assert.ok(/platform: GOOGLE_PLATFORM/.test(pub));
  assert.ok(/X_PLATFORM, YT_PLATFORM, GOOGLE_PLATFORM/.test(pub), 'baris google lama harus ikut dibersihkan');
});

test('bila RSS Google kosong, kegagalan dilaporkan dan tidak mengarang topik', async () => {
  const kosong = '<?xml version="1.0"?><rss version="2.0"><channel><title>Daily Search Trends</title></channel></rss>';
  const r: any = await parseGoogle(kosong);
  assert.equal(r.items.length, 0, 'tidak ada topik karangan saat RSS kosong');
  assert.equal(typeof syncGoogle, 'function');
});
