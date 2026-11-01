import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {extractListing, extractArticleDetail, parseListingDate, cleanTitle, entertainmentTopic} from '../src/server/hub/domain/listing-extract';
import {syncListing, verifyListing} from '../src/server/hub/domain/listing-runtime';
import {prepareCore} from '../src/server/hub/domain/schema-core';
import {prepareFeatures} from '../src/server/hub/domain/operations';

const LISTING = 'https://www.beautyhaul.com/blog/film-series';
/** Potongan HTML yang meniru kartu BeautyHaul (kelas Tailwind, Alpine, <picture>). */
const CARD_HTML = `<html><body><nav><a href="/blog/latest">Latest</a><a href="/blog/skincare">Skincare</a></nav>
 <div class="grid">
  <div class="card">
    <a href="https://www.beautyhaul.com/blog/rekomendasi-5-drakor-wajib-tonton-bulan-oktober-dibintangi-ji-won-lee-jae-wook">
      <picture><source srcset="https://cdn.beautyhaul.com/assets/uploads/thumbs/11-ab.webp 1x"><img src="/blog/static/assets/placeholder/image-placeholder-square.png" alt=""></picture>
    </a>
    <div class="flex">
      <div class="bg-[#E3F1FF] rounded-full"> Film &amp; Series </div>
      <div class="ml-auto"> 09 Oct 2026 </div>
    </div>
    <a href="https://www.beautyhaul.com/blog/rekomendasi-5-drakor-wajib-tonton-bulan-oktober-dibintangi-ji-won-lee-jae-wook">Film &amp; Series Rekomendasi 5 Drakor Wajib Tonton Bulan Oktober, Dibintangi Ji Won &amp; Lee Jae-Wook!</a>
  </div>
  <div class="card">
    <a href="https://www.beautyhaul.com/blog/6-film-wajib-tonton-buat-sambut-halloween-spooky-vibe-is-on">
      <picture><source srcset="https://cdn.beautyhaul.com/assets/uploads/thumbs/22-cd.webp 1x"><img src="/blog/static/assets/placeholder/image-placeholder-square.png"></picture>
    </a>
    <div class="flex">
      <div class="bg-[#E3F1FF] rounded-full"> Film &amp; Series </div>
      <div class="ml-auto"> 29 Oct 2026 </div>
    </div>
    <a href="https://www.beautyhaul.com/blog/6-film-wajib-tonton-buat-sambut-halloween-spooky-vibe-is-on">6 Film Wajib Tonton Buat Sambut Halloween</a>
  </div>
 </div></body></html>`;

const DETAIL_HTML = `<html><head>
  <meta name="description" content="5 drakor bulan oktober yang wajib ditonton!">
  <meta property="og:title" content="Rekomendasi 5 Drakor Wajib Tonton Bulan Oktober">
  <link rel="canonical" href="https://www.beautyhaul.com/blog/rekomendasi-5-drakor-wajib-tonton-bulan-oktober-dibintangi-ji-won-lee-jae-wook">
 </head><body>
  <div><span>By </span> Alisa Kintan</div><div>09 Oct 2026</div>
 </body></html>`;

test('kartu artikel diambil: judul bersih, tanggal, kategori, gambar (placeholder ditolak)', () => {
  const items = extractListing(CARD_HTML, LISTING);
  assert.equal(items.length, 2, 'tautan navigasi tidak boleh ikut');
  const drakor = items.find(i => i.url.includes('drakor'))!;
  assert.equal(drakor.title, 'Rekomendasi 5 Drakor Wajib Tonton Bulan Oktober, Dibintangi Ji Won & Lee Jae-Wook!');
  assert.equal(drakor.category, 'Film & Series');
  assert.equal(drakor.publishedAt, '2026-10-09T00:00:00+08:00');
  assert.equal(drakor.image, 'https://cdn.beautyhaul.com/assets/uploads/thumbs/11-ab.webp', 'placeholder diabaikan');
  // Tanggal tiap kartu tidak boleh tertukar dengan kartu sebelah.
  const halloween = items.find(i => i.url.includes('halloween'))!;
  assert.equal(halloween.publishedAt, '2026-10-29T00:00:00+08:00');
});

test('tanggal: ketelitian hari, tidak bergeser sehari', () => {
  assert.equal(parseListingDate('09 Oct 2026'), '2026-10-09T00:00:00+08:00');
  assert.equal(parseListingDate('1 November 2026'), '2026-11-01T00:00:00+08:00');
  assert.equal(parseListingDate('2026-10-31'), '2026-10-31T00:00:00+08:00');
  assert.match(String(parseListingDate('2026-10-31T21:40:56Z')), /^2026-10-31T21:40:56/);
  assert.equal(parseListingDate('tanpa tanggal'), null);
});

test('cleanTitle membuang tempelan kategori & tanggal', () => {
  assert.equal(cleanTitle('Film & Series 09 Oct 2026 Judul Berita', 'Film & Series'), 'Judul Berita');
  assert.equal(cleanTitle('Pop Culture · Judul Lain', 'Pop Culture'), 'Judul Lain');
});

test('detail artikel: kanonik, deskripsi, penulis dari byline, tanggal kepala artikel', () => {
  const d = extractArticleDetail(DETAIL_HTML, LISTING);
  assert.equal(d.canonical, 'https://www.beautyhaul.com/blog/rekomendasi-5-drakor-wajib-tonton-bulan-oktober-dibintangi-ji-won-lee-jae-wook');
  assert.equal(d.description, '5 drakor bulan oktober yang wajib ditonton!');
  assert.equal(d.author, 'Alisa Kintan');
  assert.equal(d.publishedAt, '2026-10-09T00:00:00+08:00');
});

test('kata kunci hiburan Asia: Drakor, Dracin (ejaan situs), K-Pop, aktor Korea, film Asia', () => {
  assert.equal(entertainmentTopic('Rekomendasi 5 Drakor Wajib Tonton'), 'Drakor');
  assert.equal(entertainmentTopic('Ini 4 Drachin Soal Percintaan di Kantor'), 'Dracin');
  assert.equal(entertainmentTopic('Drama China terbaru bulan ini'), 'Dracin');
  assert.equal(entertainmentTopic('Comeback K-Pop bulan ini, girl group baru debut'), 'K-Pop');
  assert.equal(entertainmentTopic('5 Aktris Korea yang dinobatkan tercantik'), 'Aktor Korea/China');
  assert.equal(entertainmentTopic('Review Tiga Film Indonesia yang Tayang di Busan International Film Festival'), 'Film & Serial Asia');
  // Yang harus DITOLAK: bukan hiburan Asia.
  assert.equal(entertainmentTopic('Review Sheet Mask Terbaru, Real Pakai Diamond'), null);
  assert.equal(entertainmentTopic('6 Film Wajib Tonton Buat Sambut Halloween'), null, 'film Barat tanpa kata kawasan');
  assert.equal(entertainmentTopic('8 Rekomendasi Ube Matcha di Jakarta'), null);
});

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'listing-'));
  const db = createClient({url: 'file:' + path.join(dir, 'l.db')});
  await db.executeMultiple(readFileSync('db/hub-migrations/001_initial.sql', 'utf8'));
  await prepareCore(db);
  await prepareFeatures(db);
  const SRC = 'cccccccc-1111-1111-1111-111111111111';
  await db.execute({
    sql: "INSERT INTO hub_sources(id,name,jurisdiction,region,requested_url,normalized_url,publisher_domain,source_kind,discovered_type,rights_status,is_active,feed_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'rss',?,'permission_confirmed',1,?,?,?)",
    args: [SRC, 'beautyhaul', 'Nasional', 'Nasional', LISTING, LISTING, 'beautyhaul.com', 'html_listing', LISTING, '2026-11-01', '2026-11-01'],
  });
  const close = db.close.bind(db);
  (db as any).close = async (...a: any[]) => { await (close as any)(...a); try { rmSync(dir, {recursive: true, force: true}); } catch {} };
  return {db, SRC};
}

test('syncListing: hanya artikel hiburan Asia masuk, kolom lengkap, duplikat dilewati', async () => {
  const {db, SRC} = await fixture();
  try {
    const fake = (url: string): Promise<string> => {
      if (url === LISTING) return Promise.resolve(CARD_HTML);
      if (url.includes('drakor')) return Promise.resolve(DETAIL_HTML);
      return Promise.resolve('<html><head><meta property="og:title" content="6 Film Halloween"></head><body>By Redaksi 29 Oct 2026</body></html>');
    };
    const out = await syncListing(db, SRC, {fetcher: fake, topicFilter: true}) as unknown as {inserted: number; filtered: number; enriched: number};
    assert.equal(out.inserted, 1, 'hanya Drakor yang lolos penyaring');
    assert.equal(out.filtered, 1, 'artikel Halloween disaring');
    const row = (await db.execute('SELECT source_title,source_published_at,source_snippet,source_image_url FROM hub_items')).rows[0];
    assert.match(String(row.source_title), /Drakor/);
    // Disimpan sebagai UTC; yang penting instan waktunya sama dengan 9 Okt 2026 00:00 WITA.
    assert.equal(Date.parse(String(row.source_published_at)), Date.parse('2026-10-09T00:00:00+08:00'));
    assert.match(String(row.source_snippet), /wajib ditonton/);
    assert.match(String(row.source_image_url), /cdn\.beautyhaul\.com/);
    // Putaran kedua: tidak boleh menambah apa pun. Cooldown 2 menit antar-job sengaja dilewati di tes.
    await db.execute('UPDATE hub_jobs_v3 SET cooldown_until=0, lease_until=0');
    const again = await syncListing(db, SRC, {fetcher: fake, topicFilter: true}) as unknown as {inserted: number; skipped: number};
    assert.equal(again.inserted, 0);
    assert.equal(again.skipped, 1);
  } finally { await db.close(); }
});

test('saklar: halaman daftar tanpa artikel → sumber TIDAK menyala', async () => {
  const {db} = await fixture();
  try {
    await db.execute("UPDATE hub_sources SET feed_url='https://tidak-ada.contoh.invalid/daftar', is_active=0");
    await db.execute('UPDATE hub_jobs_v3 SET cooldown_until=0, lease_until=0');
    await assert.rejects(() => verifyListing(db, 'cccccccc-1111-1111-1111-111111111111'), (e: Error) => {
      assert.doesNotMatch(e.message, /^SYNC_FAILED$/); // sebab asli harus ikut terbaca
      return true;
    });
    const row = (await db.execute('SELECT discovered_type,is_active FROM hub_sources')).rows[0];
    assert.equal(String(row.is_active), '0', 'sumber tetap mati');
  } finally { await db.close(); }
});
