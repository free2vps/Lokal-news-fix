> **Arsip proyek lama:** petunjuk di bawah belum berlaku untuk Hub terpadu tahap awal. Route otomatis/push lama dinonaktifkan dalam salinan ini. Jangan gunakan instruksi arsip ini untuk deployment atau operasi. Untuk peninjauan branch Preview baca `PANDUAN-BRANCH-PREVIEW.md`; untuk batasan sistem baca `README-HUB-TERPADU.md`.

> **Panduan terbaru AI dashboard/failover dan E2E:** lihat `PANDUAN-AI-DASHBOARD-E2E.md`. Tampilan awal tetap dipertahankan. Patch metadata Groq masih perlu Preview deployment baru.

# Integrasi Content Hub untuk website Anda

Kode ini adalah penyesuaian repository publik `free2vps/Lokal-news-fix`, commit basis `e29c584112672ec21ede4195e648b3094ec49a45`. Repository remote diperiksa ulang dan masih menggunakan commit yang sama saat pengerjaan. Website, layout, komponen, domain, dan database lama tidak dibuat ulang.

**Status terbaru:** kode sudah diubah dan diuji secara lokal, belum di-push ke GitHub atau dideploy. Migrasi tambahan cache dan lease sudah dijalankan dengan persetujuan Anda pada proyek Supabase Lokal News, lalu RLS dan hak akses diverifikasi. Tabel baru masih kosong; impor artikel belum dijalankan. Paket tidak berisi kredensial.

## Arsitektur

```
Backend Content Hub (RSS, Trends24 1 hour ago, playlist YouTube)
  → endpoint portal-feed terproteksi
  → cron/backend Next.js Vercel
  → articles + content_hub_cache di Supabase
  → komponen website yang sudah ada
```

Vercel membaca hasil jadi, bukan meringkas ulang dengan AI. Pada mode Content Hub, jalur sync berita maupun trending tidak memanggil pipeline sumber eksternal/AI lama. Data Supabase yang sudah tersimpan masih dapat dibaca ketika sandbox Arena mati. Pengambilan data baru tetap memerlukan backend Content Hub yang hidup; cron Vercel tidak membangunkan sandbox Arena.

## Yang disesuaikan

- `src/lib/content-hub/mapping.ts`: validasi respons, pemetaan artikel/kategori/tag/wilayah ke bentuk website; pemetaan X ke platform x_t24 dan video playlist ke yt_feed. Nilai ai_summary adalah kolom kompatibilitas, bukan klaim penggunaan AI.
- `src/lib/content-hub/import.ts`: impor artikel recommended maksimal 100 kandidat, konflik source_url dilewati, count inserted berdasarkan ID yang dikembalikan database; snapshot X dan YouTube disimpan terpisah, kegagalan satu sumber tidak menghentikan yang lain, snapshot valid lama tidak dihapus saat respons kosong/gagal.
- `src/lib/content-hub/cache.ts`: pembacaan snapshot server-side dari Supabase.
- `supabase/migrations/20261027_content_hub.sql`: tabel cache, lease lintas proses, fungsi acquire/release lock; RLS dan pencabutan akses anon/authenticated. Service role digunakan hanya di backend.
- `src/app/api/cron/route.ts`: mode Content Hub tidak menjalankan AI atau distribusi sosial; status 207 bila sebagian tugas gagal. Endpoint tetap memerlukan CRON_SECRET.
- `src/lib/ingest/pipeline.ts` dan `src/lib/trending/run.ts`: tombol admin sync juga mengikuti mode Content Hub; tidak diam-diam kembali memakai AI saat impor gagal.
- `src/app/api/content-hub/route.ts`: API publik website hanya membaca snapshot Supabase, bukan menghubungi sandbox setiap dibuka. Query type recommended/news/x-trends/youtube-music/all; limit/cursor dan filter artikel dibatasi pada snapshot yang telah diimpor. Respons memuat cacheStatus dan importedAt.
- `src/lib/queries.ts`: saat mode baru aktif, tren X/video diambil dari cache, hanya posting manual yang melengkapi sumber tersebut. Feed terbaru dibatasi 72 jam; halaman detail historis tetap dapat diakses. Kegagalan baca cache menghasilkan daftar tren kosong ditambah posting manual, bukan data buatan.
- Homepage: pool awal 6 berita + 4 hiburan pada mode baru, disusul feed campuran existing 6:4. Stok kategori tidak cukup, filter gambar, blok kategori, dan shelf video dapat membuat rasio seluruh halaman berbeda; bukan jaminan semua elemen visual halaman tepat 60:40. Bobot audiens dari Content Hub memengaruhi pemilihan kandidat impor; urutan website existing tetap berdasarkan waktu, bukan pelestarian skor rekomendasi persis.
- Label ringkasan detail dan klaim frekuensi diperbaiki; snapshot X memberi waktu sumber dan label data lama. Tampilan tidak menyamakan tren Google dengan X bila X kosong.

## Langkah pemasangan (jangan langsung mengaktifkan produksi)

1. Buat branch `integrate-content-hub` pada repository existing. Gunakan file perubahan dalam paket `file-perubahan` atau patch. Arsip source lengkap juga disediakan sebagai alternatif.
2. Untuk proyek Supabase Lokal News yang sudah diperiksa: migrasi `supabase/migrations/20261027_content_hub.sql` SUDAH dijalankan dan diverifikasi. Tidak perlu menjalankannya lagi. File SQL tetap disertakan sebagai dokumentasi dan untuk instalasi pada database lain.
3. Periksa tabel `articles` sebelum uji impor: `source_url` harus UNIQUE seperti yang dibutuhkan pipeline lama; `source_id` harus nullable atau punya default yang sesuai. Kode tidak mengirim UUID sumber sandbox ke kolom foreign key sumber website. Jangan menonaktifkan constraint secara sembarangan; jika syarat ini tidak cocok, sesuaikan schema/source mapping dahulu.
4. Tambahkan ke environment **Preview** Vercel:
   - `CONTENT_HUB_ENABLED=true`
   - `PORTAL_HUB_URL` = origin HTTPS preview Content Hub port 3000, bukan localhost dan tanpa path /api.
   - `PORTAL_API_TOKEN` = token `portal` dari backend Content Hub, **bukan password admin**.
   - Pertahankan konfigurasi Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) dan `CRON_SECRET` yang sudah digunakan website.
5. Redeploy branch uji. Tidak perlu mengubah main/production terlebih dahulu.
6. Panggil `/api/cron` melalui alat HTTP backend dengan header `Authorization: Bearer [CRON_SECRET]`. Ini MENULIS artikel/snapshot ke Supabase yang dikonfigurasi; jangan menguji pada database produksi bila belum siap. Preview dan production dengan database sama akan berbagi data.
7. Periksa respons (200 atau 207), tabel articles, snapshot cache, halaman utama, detail artikel, panel X dan video. Periksa `/api/content-hub?type=recommended&limit=20`, `?type=x-trends`, `?type=youtube-music`.
8. Baru merge/deploy produksi setelah pengujian berhasil. Rotasi secret bila pernah dibagikan. Jangan menyimpan secret di source atau chat.

Jika menggunakan terminal lokal pada branch bersih:

```bash
git apply --check portal-content-hub-vercel-v2.patch
git apply portal-content-hub-vercel-v2.patch
npm ci
npm test
npx tsc --noEmit
npm run build
```

Tidak perlu menerapkan patch jika sudah menyalin semua file perubahan. Jangan menimpa root repository dengan satu folder pembungkus tambahan. Bila main sudah berubah, periksa konflik dahulu.

## Cron

`vercel.json` tetap `0 6 * * *` pada `/api/cron` (14.00 WITA). Tidak mengklaim pembaruan per jam: kelayakan frekuensi dan kuota paket harus diperiksa. Cron trading endpoint terpisah tidak otomatis dijadwalkan. Lock Supabase menahan satu importer maksimum dua menit dan dilepas saat selesai; ini bukan antrean durable. Tidak ada cron baru/berbayar yang diaktifkan pada akun Anda.

## Hasil pengujian

- `npm test`: 10 test lulus untuk pemetaan, tanggal invalid/stale/future, label snapshot X, video valid, kategori, URL, impor berulang tanpa duplikat, kegagalan sumber terisolasi, cache lama bertahan, dan lock impor bersamaan.
- Pengujian impor memakai adapter database tiruan, bukan Supabase asli. Fixture hanya di folder tests dan tidak dimasukkan ke tabel operasional.
- `npx tsc --noEmit`: lulus.
- `npm run build`: produksi Next.js berhasil, 13 halaman statis dan route dinamis termasuk endpoint baru. Build memakai URL Supabase placeholder dan kredensial dummy untuk validasi, bukan database Anda. Ini bukan verifikasi SQL atau koneksi deployment produksi.

## Batasan tersisa

- Migrasi SQL sudah dieksekusi pada Supabase Lokal News dan RLS/privilege diverifikasi. Kolom articles, source_id nullable, dan unique source_url sudah diperiksa langsung. Penulisan artikel/snapshot melalui importer dan deployment Vercel belum diuji pada layanan asli.
- Impor kandidat maksimum 100 tiap putaran, bukan penelusuran seluruh arsip; beberapa metadata teknis tidak masuk tabel articles. Snapshot API berita hanya mencakup kandidat impor, bukan seluruh database website.
- Artikel duplikat source_url tidak ditimpa agar edit editorial existing aman. Ringkasan sumber yang berubah tidak otomatis mengganti artikel lama.
- AI tidak melakukan pemeriksaan fakta. Tanggal/atribusi bergantung metadata sumber. Perlu evaluasi editorial dan hak penggunaan konten/gambar sebelum publikasi.
- Urutan rekomendasi/audience score tidak disimpan sebagai urutan homepage; mesin website masih menggunakan waktu dan feed 6:4. Jangan menyebut seluruh master prompt selesai.
- Dependency audit melaporkan dua temuan (Next moderate, PostCSS high); perbaikan otomatis merekomendasikan upgrade major Next 16. Upgrade tersebut belum diterapkan karena memerlukan pengujian kompatibilitas tersendiri. Tinjau sebelum peluncuran publik.
- Belum ada hosting backend permanen untuk kolektor. Supabase melindungi ketersediaan data terakhir, bukan menjamin data baru saat sandbox mati.

## Pembatalan mode uji

Set `CONTENT_HUB_ENABLED=false`, lalu redeploy untuk kembali ke pipeline lama. **Pipeline lama dapat memanggil AI berbayar bila cron/tombol sync dijalankan**; jangan gunakan rollback ini sebagai cara mematikan semua pemrosesan. Bila ingin berhenti memproses tanpa memanggil AI, nonaktifkan jadwal/tindakan sync. Tabel dan artikel yang sudah diimpor tidak dihapus oleh perubahan flag.
