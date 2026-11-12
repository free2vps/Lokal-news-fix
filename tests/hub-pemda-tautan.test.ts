import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {uraiRobots, aturanUntuk, bolehDiakses, periksaRobots} from '../src/lib/pemda/robots';
import {sadurHtml, sadurTautan, ambilKalimat, bersihkanJudul, bacaTanggalTeks} from '../src/lib/pemda/sadur';

// ── robots.txt ──────────────────────────────────────────────────────────────
test('robots: "Disallow:" kosong = semua boleh (kasus ppid.sumbawabaratkab.go.id)', () => {
  const aturan = aturanUntuk(uraiRobots('User-agent: *\nDisallow:\n'), 'PortalHubBot');
  assert.equal(bolehDiakses(aturan, '/en/article/abc'), true);
});

test('robots: "Disallow: /" menolak semua (kasus Google News)', () => {
  const aturan = aturanUntuk(uraiRobots('User-agent: *\nDisallow: /\nAllow: /robots.txt\n'), 'PortalHubBot');
  assert.equal(bolehDiakses(aturan, '/rss/articles/abc'), false);
  assert.equal(bolehDiakses(aturan, '/robots.txt'), true);
});

test('robots: kelompok khusus bot menang atas "*", pola terpanjang menang', () => {
  const isi = [
    'User-agent: *', 'Disallow: /', '',
    'User-agent: PortalHubBot', 'Disallow: /privasi', 'Allow: /', '',
    'User-agent: LainBot', 'Disallow: /', '',
  ].join('\n');
  const aturan = aturanUntuk(uraiRobots(isi), 'PortalHubBot');
  assert.equal(bolehDiakses(aturan, '/en/article/abc'), true);
  assert.equal(bolehDiakses(aturan, '/privasi/kebijakan'), false);
  assert.equal(bolehDiakses(uraiRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\n')[0].aturan, '/a/b/c'), true);
});

test('robots: 403 dan 5xx diperlakukan sebagai DILARANG, 404 sebagai boleh', async () => {
  const buat = (status: number, body = '') => (async () => new Response(body, { status })) as unknown as typeof fetch;
  assert.equal((await periksaRobots('https://a.go.id/x', { fetcher: buat(403) })).diizinkan, false);
  assert.equal((await periksaRobots('https://a.go.id/x', { fetcher: buat(503) })).diizinkan, false);
  assert.equal((await periksaRobots('https://a.go.id/x', { fetcher: buat(404, 'File not found.') })).diizinkan, true);
  // Jaringan mati juga dianggap terlarang (konservatif).
  const mati = (async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
  assert.equal((await periksaRobots('https://a.go.id/x', { fetcher: mati })).diizinkan, false);
});

// ── Penyadur ────────────────────────────────────────────────────────────────
const htmlUji = `<!doctype html><html><head>
<meta property="og:title" content="Pemkab Sumbawa Barat Buka Seleksi PPPK 2026">
<meta property="og:site_name" content="PPID Sumbawa Barat">
<meta property="og:image" content="/gambar/pppk.jpg">
<meta property="article:published_time" content="2026-10-20T08:30:00+08:00">
</head><body><nav>Menu Beranda Profil</nav><article>
<p>Pemerintah Kabupaten Sumbawa Barat membuka seleksi penerimaan pegawai pemerintah dengan perjanjian kerja untuk formasi tahun anggaran 2026 melalui portal resmi daerah.</p>
<p>Pendaftaran dilakukan secara daring dan tidak dipungut biaya apa pun. Pelamar diimbau hanya menggunakan kanal resmi yang diumumkan pemerintah daerah.</p>
<p>Berkas</p>
</article><footer>Hak cipta pemda</footer></body></html>`;

test('sadur: mengambil judul, tanggal, gambar absolut, dan ringkasan kalimat asli', () => {
  const h = sadurHtml(htmlUji, 'https://ppid.sumbawabaratkab.go.id/en/article/pppk');
  assert.ok(!('kode' in h));
  if ('kode' in h) return;
  assert.match(h.judul, /Seleksi PPPK/);
  assert.equal(h.sumber_nama, 'PPID Sumbawa Barat');
  assert.equal(h.gambar_url, 'https://ppid.sumbawabaratkab.go.id/gambar/pppk.jpg');
  assert.equal(h.tanggal, '2026-10-20T00:30:00.000Z');
  // Hanya kalimat asli sumber — tidak ada paragraf pendek sampah, tidak ada menu.
  assert.match(h.ringkasan, /seleksi penerimaan pegawai/i);
  assert.ok(!/Menu Beranda/.test(h.ringkasan));
  assert.ok(!/\bBerkas\b/.test(h.ringkasan));
  assert.ok(h.ringkasan.length <= 420);
});

test('sadur: ringkasan TIDAK boleh memotong kalimat di tengah', () => {
  const kalimat = 'Pemerintah daerah mengumumkan jadwal seleksi terbuka untuk umum pada bulan depan.';
  const hasil = ambilKalimat(`${kalimat} ${kalimat} ${kalimat}`, 60);
  assert.equal(hasil, '', 'kalau tidak ada kalimat utuh yang muat, hasilnya kosong — bukan potongan');
  const muat = ambilKalimat(`${kalimat} ${kalimat}`, 200);
  assert.ok(muat.endsWith('.'), 'ringkasan harus berakhir di akhir kalimat');
});

test('sadur: halaman tanpa paragraf isi ditolak, bukan diterbitkan kosong', () => {
  const h = sadurHtml('<html><head><title>PPID</title></head><body><div>Memuat…</div></body></html>', 'https://a.go.id/x');
  assert.ok('kode' in h && h.kode === 'ISI_TIDAK_ADA');
});

test('sadur: tembok anti-bot dan http ditolak tanpa upaya menembus', async () => {
  const cf = (async () => new Response('<html><title>Just a moment...</title><div id="cf-browser-verification"></div></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
  const hasil = await sadurTautan('https://a.go.id/x', cf);
  assert.ok('kode' in hasil && hasil.kode === 'ANTI_BOT');

  const captcha = (async () => new Response('<html>Please complete the reCAPTCHA</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
  assert.ok('kode' in (await sadurTautan('https://a.go.id/y', captcha)));

  assert.ok('kode' in (await sadurTautan('http://a.go.id/x', cf)), 'http biasa ditolak');

  const bukanHtml = (async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } })) as unknown as typeof fetch;
  assert.ok('kode' in (await sadurTautan('https://a.go.id/x.pdf', bukanHtml)));
});

// ── Aturan pemasangan ───────────────────────────────────────────────────────
const tanpaKomentar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

test('API memeriksa robots SEBELUM menyadur, dan tidak ada jalur terbit otomatis', () => {
  const r = tanpaKomentar(readFileSync('src/app/api/hub/pemda-draft/route.ts', 'utf8'));
  assert.match(r, /periksaRobots\(/);
  assert.ok(r.indexOf('periksaRobots(') < r.indexOf('sadurTautan('), 'robots harus diperiksa sebelum halaman diambil');
  assert.match(r, /if\(!robots\.diizinkan\)return errorJson/);
  assert.match(r, /authenticatedDb\(request\)/);
  assert.match(r, /if\(!writesAllowed\(\)\)/);
  // Tidak boleh ada AI/parafrase di jalur ini (brief §5).
  assert.ok(!/openrouter|mistral|groq|openai|anthropic|gemini/i.test(r), 'jalur pemda tidak boleh memanggil AI');
  // Draf tidak boleh terbit tanpa aksi 'setuju'.
  assert.match(r, /action==='setuju'/);
  assert.match(r, /jenis_sumber:'rilis'/);
});

test('migrasi draf: unik per alamat, status terbatas, tanpa akses publik', () => {
  const sql = readFileSync('supabase/migrations/20261112_pemda_draft.sql', 'utf8');
  assert.match(sql, /sumber_url\s+text not null unique/i);
  assert.match(sql, /check \(status in \('draf','disetujui','ditolak'\)\)/);
  assert.match(sql, /enable row level security/i);
  assert.equal((sql.match(/create policy/gi) || []).length, 0, 'draf internal tidak boleh punya policy publik');
});

test('panel pemilik punya tombol Setujui/Tolak dan menjelaskan alurnya', () => {
  const p = tanpaKomentar(readFileSync('src/components/hub/PemdaDraftPanel.tsx', 'utf8'));
  assert.match(p, /Setujui & terbitkan/);
  assert.match(p, /putuskan\(r\.id,'tolak'\)/);
  assert.match(p, /robots/i);
  const mod = tanpaKomentar(readFileSync('src/components/hub/HubModules.tsx', 'utf8'));
  assert.match(mod, /<PemdaDraftPanel\/>/);
});

test('sadur: judul dibersihkan dari nama situs, tapi berita yang menyebut daerah tidak dipotong', () => {
  const situs = 'PPID Sumbawa Barat';
  assert.equal(bersihkanJudul(`PPID Kabupaten ${'Sumbawa Barat'} - APBD KSB 2027 Ditetapkan`, situs), 'APBD KSB 2027 Ditetapkan');
  assert.equal(bersihkanJudul('PPID Kabupaten Sumbawa Barat - KSB Raih Penghargaan TPID', situs), 'KSB Raih Penghargaan TPID');
  // Tidak ada pemisah → milik berita, jangan dipotong.
  assert.equal(bersihkanJudul('APBD Sumbawa Barat 2027 Ditetapkan', situs), 'APBD Sumbawa Barat 2027 Ditetapkan');
  assert.equal(bersihkanJudul('Bupati Sumbawa Barat Buka Karnaval Budaya', situs), 'Bupati Sumbawa Barat Buka Karnaval Budaya');
  // Sisa terlalu pendek → judul asli dikembalikan.
  assert.equal(bersihkanJudul('Website Resmi - Kabupaten Sumbawa Barat', situs), 'Website Resmi - Kabupaten Sumbawa Barat');
});

test('sadur: entitas HTML diurai dan tanggal bergaya Indonesia terbaca', () => {
  const h = sadurHtml('<html><head><meta property="og:title" content="Uji"></head><body><article>'
    + '<p>Rapat paripurna DPRD Kabupaten Sumbawa Barat menetapkan raperda itu menjadi peraturan daerah pada hari ini, Senin (9/11/2026), setelah melalui pembahasan bersama.</p>'
    + '<p>Penandatanganan dilakukan di ruang rapat utama dan disaksikan seluruh anggota dewan serta perangkat daerah terkait.</p></article></body></html>', 'https://a.go.id/x');
  assert.ok(!('kode' in h)); if ('kode' in h) return;
  assert.ok(!/&ndash;|&[a-z]+;/.test(h.ringkasan), 'entitas HTML harus diurai');
  assert.equal(h.tanggal, '2026-11-09T00:00:00.000Z', 'tanggal dd/mm/yyyy harus terbaca');
  assert.equal(bacaTanggalTeks('Kegiatan 9 November 2026 di Taliwang'), '2026-11-09T00:00:00.000Z');
});
