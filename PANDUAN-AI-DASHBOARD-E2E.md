> **Arsip proyek lama:** petunjuk di bawah belum berlaku untuk Hub terpadu tahap awal. Route otomatis/push lama dinonaktifkan dalam salinan ini. Jangan gunakan instruksi arsip ini untuk deployment atau operasi. Untuk peninjauan branch Preview baca `PANDUAN-BRANCH-PREVIEW.md`; untuk batasan sistem baca `README-HUB-TERPADU.md`.

# Pengaturan AI di dashboard Hub dan hasil E2E

27 Oktober 2026 — menggantikan status AI/E2E dalam laporan compact sebelumnya. Tampilan awal portal tetap dipertahankan.

## Yang sudah diimplementasikan

Buka **Live Preview Portal Content Hub, port 3000 → login admin → Pengaturan AI**. Port 3001 adalah portal berita, bukan dashboard Hub.

- API key, model, urutan prioritas, status provider, izin cuplikan publik, batas request/24 jam dan artikel/batch dapat diatur dari dashboard.
- Kolom key kosong berarti mempertahankan key lama. Penghapusan harus memakai checkbox Hapus. Key tidak dikirim kembali pada API baca, tidak dimasukkan ke localStorage, dan tidak masuk prompt AI.
- Penyimpanan key/config memakai AES-256-GCM dan berkas master key terpisah, permission 0600, write atomik. Ini melindungi dari pembacaan config tanpa master key, **bukan dari pengambilalihan penuh server atau pencurian config beserta master key**. Data/master key perlu penyimpanan persisten dan backup privat; jangan masukkan ke GitHub/ZIP publik.
- Key OpenRouter/Mistral yang sebelumnya tersedia di backend sudah diimpor ke penyimpanan dashboard pada setup pertama. Setelah itu jalur push membaca konfigurasi dashboard, bukan meminta Anda mengedit env untuk mengganti model/key AI.
- Mengganti key di dashboard tidak mencabut key lama pada provider; revokasi tetap perlu dilakukan di dashboard provider setelah pengganti teruji.
- Konfigurasi transport push, autentikasi admin, dan secret operasional server tetap backend-only; menu ini bukan pengganti seluruh konfigurasi infrastruktur.

## Urutan dan kebijakan provider

Urutan default: **OpenRouter → Groq → Cohere → Mistral**. Provider nonaktif/tidak lengkap/cooldown dilewati.

- OpenRouter dibatasi pada `openrouter/free` atau model `:free`, dengan routing harga input/output nol.
- Groq memerlukan konfirmasi bahwa akun benar-benar Free tanpa billing berbayar. Aplikasi **tidak dapat mendeteksi paket billing akun** dan tidak otomatis mengubah paket akun.
- Cohere dibatasi **evaluasi dengan trial key gratis**. Tidak memiliki toggle rantai publik, tidak ikut proses push, dan hasil evaluasinya dipisahkan dari cache publik. Importer portal tidak menerima override metadata `cohere_ntb`.
- Mistral tetap opsional/nonaktif; memerlukan konfirmasi akun Free sebelum dipakai.
- Saat ini key Groq/Cohere belum dimasukkan dan koneksi riil keduanya belum diuji. Failover OpenRouter → Groq telah diuji dengan respons mock terkontrol, bukan diklaim sebagai panggilan Groq nyata.

### Memasang Groq tanpa membuka env/Vercel

1. Pastikan akun Groq Free; jangan gunakan key akun berbayar dengan asumsi aplikasi menjamin gratis.
2. Dalam menu Pengaturan AI, isi key Groq, **biarkan provider nonaktif**, lalu Simpan.
3. Klik **Muat model tersimpan**, pilih model chat yang tersedia atau isi ID model yang valid, lalu konfirmasikan paket Free dan centang ikut rantai fallback. Simpan lagi.
4. Pilih artikel NTB, klik **Uji groq**. Ini memakai kuota tetapi tidak mengirim artikel ke Supabase.
5. Klik **Uji rantai fallback tersimpan** untuk menguji konfigurasi publik. Provider yang sukses menghentikan rantai; fallback tidak dipanggil jika hasil awal valid atau cache valid tersedia.
6. Uji provider menampilkan HTTP/alasan yang disanitasi. Respons gagal/terpotong tidak dipublikasikan. Tunggu cooldown; jangan mengganti key/model untuk mengakali rate limit.

Untuk Cohere: simpan key Trial dan model, centang konfirmasi Trial untuk evaluasi, lalu gunakan Uji cohere. Jangan memasukkannya sebagai cadangan situs publik.

## Pengamanan pemrosesan

- Hanya judul dan cuplikan publik NTB; bukan data admin/secret, bukan scraping artikel penuh.
- Validasi panjang metadata, kategori, grounding, angka dan tag tetap berlaku. Respons `length`/terpotong ditolak.
- Provider HTTP 429/timeout/5xx/metadata tidak valid dapat dialihkan ke provider berikutnya. 429 memakai cooldown dari Retry-After dengan pembatas konservatif; kesalahan credential/model juga mendapat cooldown.
- Maksimum total request per rolling 24 jam berlaku bersama, termasuk tes dan fallback. Default 20 request/24 jam, 1 artikel/batch; satu artikel yang memakai dua provider menghabiskan dua request.
- Pemrosesan diberi deadline, cache, dan lease ber-owner di SQLite agar proses tidak berjalan bersamaan. Riwayat menyimpan provider/model/HTTP/alasan, bukan key atau prompt.
- Artikel dengan ringkasan editorial manual dilewati. Artikel duplikat di Supabase tidak diperbarui: importer memakai ignoreDuplicates.
- Jika semua gagal, data asli tetap tersedia; cache valid dipertahankan.
- **AI rutin tetap OFF pada penyerahan ini**. Uji eksplisit dapat berjalan tanpa menyalakan AI pada semua push rutin. Aktifkan setelah konfigurasi dan Preview baru diverifikasi.

## E2E nyata yang telah berhasil

Artikel: **Bahasa Sasak Berpeluang Jadi Mapel di Sekolah**, Suara NTB.

- Provider: **OpenRouter**, actual model **`liquid/lfm-2.5-2.6b:free`**.
- Model menghasilkan metadata valid setelah percobaan sebelumnya gagal validasi; percobaan gagal tidak dipush. Cooldown dihormati. Tidak ada paid fallback.
- Kandidat dicek belum ada di Supabase sebelum push. Sebanyak 76 kandidat snapshot lama diperiksa; source URL lama sudah ada di database.
- Push signed ke Preview: **HTTP 200, found 77, inserted 1, skipped 75, errors 0**. Found adalah kandidat mentah, bukan jumlah baris yang pasti dapat dipetakan; statistik ini tidak berarti dua artikel baru.
- Snapshot recommended lama dipertahankan dengan satu tambahan kandidat; payload X dan YouTube dipertahankan. Tidak ada overwrite artikel lama/manual.
- HTML Preview artikel: **HTTP 200**. Judul artikel/H1 dan ringkasan asli tetap; `<title>`, description, Open Graph, dan deskripsi NewsArticle JSON-LD sesuai metadata AI; waktu publikasi sama secara waktu absolut; atribusi dan tautan sumber tersedia.
- Canonical artikel memakai domain Production, bukan localhost.

Preview artikel:
https://lokal-news-fix-ujsf-git-integrate-content-hub-free2vps.vercel.app/berita/bahasa-sasak-berpeluang-jadi-mapel-di-sekolah-hub-6689d2ebb8fb

Preview memakai Supabase bersama, sehingga artikel baru dapat muncul di situs utama walau kode tidak dimerge. **Tidak ada merge atau deployment kode Production dalam pekerjaan AI ini.**

## Hasil pengujian dan batas yang masih ada

- Hub: **31/31 unit/regression tests PASS**, tanpa panggilan AI nyata dari unit test.
- Website: **25/25 tests PASS**, typecheck dan production build PASS.
- Dashboard Chromium desktop/mobile: login terlindungi, unauthorized 401, mutasi tanpa CSRF 403, endpoint bebas ditolak 400, tidak ada key dalam respons baca, cache-control no-store, simpan berhasil, key yang belum disimpan tidak hilang oleh refresh berkala, tanpa error JavaScript atau overflow dokumen pada pemeriksaan.
- Verifikasi browser artikel **build lokal terbaru**: HTTP 200, metadata/H1/tautan sumber sesuai, tanpa error JavaScript.
- **Preview Vercel lama**: metadata SEO/HTML benar, tetapi Chromium masih mendeteksi **React hydration error #418**. Local build dengan perbaikan yang sudah tersedia tidak mengalami error ini. Jangan menyatakan seluruh pemeriksaan browser Vercel lulus sebelum Preview memakai paket kode baru dan diuji ulang.
- Metadata Groq sudah didukung importer **lokal** dengan pemeriksaan provenance. Preview Vercel lama belum menerima patch Groq tersebut; perlu upload/deploy branch integrasi sebelum memakai Groq untuk publikasi riil. Jalur push memeriksa capability receiver dan membatalkan push Groq jika bridge belum mendukungnya, sehingga metadata tidak diam-diam dibuang.
- Groq/Cohere belum diuji dengan key nyata karena belum tersedia. Secret rotation tetap pekerjaan terpisah yang belum selesai; jangan menganggap rilis Production sudah disetujui.
- Live Preview Arena bukan layanan 24/7. Dashboard dan scheduler hanya hidup saat backend berjalan; diperlukan hosting backend dengan disk persisten untuk operasi berkelanjutan.

Bukti tersimpan di `preview-audit`: `ai-failover-live.json`, `e2e-preflight.json`, `e2e-push-one.json`, `e2e-html-result.json`, `hub-ai-browser.json`, `e2e-browser-local.json`, serta screenshot. Semua ini adalah hasil pengamatan aktual, bukan skor/hasil tiruan.

## Paket yang dipakai berikutnya

- `content-hub-ai-dashboard.zip`: source Hub dengan menu AI, encrypted store, failover dan tes. Tidak berisi data, key, database, master key, dependency, atau log privat. Saat memperbarui Hub yang sudah ada, **pertahankan folder data privat di host**; jangan menghapusnya.
- `lokal-news-ai-bridge-tampilan-awal.zip`: website dengan tampilan awal tetap, plus penerimaan metadata Groq dan perbaikan teknis yang sudah tersedia. Belum diunggah ke GitHub atau Vercel.
- Upload website hanya ke **branch integrate-content-hub**, bukan main. Setelah Preview build baru READY, ulangi pemeriksaan browser dan uji Groq dengan key pengguna. Jangan melakukan merge/promotion otomatis.
