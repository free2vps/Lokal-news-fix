> **Arsip proyek lama:** petunjuk di bawah belum berlaku untuk Hub terpadu tahap awal. Route otomatis/push lama dinonaktifkan dalam salinan ini. Jangan gunakan instruksi arsip ini untuk deployment atau operasi. Untuk peninjauan branch Preview baca `PANDUAN-BRANCH-PREVIEW.md`; untuk batasan sistem baca `README-HUB-TERPADU.md`.

# Penguatan SEO — tahap 1

Status: diuji lokal (15 tes, TypeScript, production build). Belum di-upload atau dideploy.
Pakai paket ini pada branch integrate-content-hub; jangan langsung main.
Panduan push sebelumnya tetap berlaku; tidak ada env baru, migrasi, cron atau impor baru.

## Perubahan
- Metadata artikel baru dari Hub: bersihkan markup, ringkas pada batas kata (65/155 karakter).
- Poin penting diekstrak dari kalimat lengkap sumber, hanya jika cukup bahan; bukan AI.
- Subjudul konteks netral untuk ringkasan yang memang sudah memiliki beberapa paragraf.
- Tidak membuat fakta, keyword daerah baru atau jawaban 5W+1H yang hilang.
- Slug dan kebijakan jangan overwrite artikel lama tetap dipertahankan.
- Schema NewsArticle memakai headline yang tampil dan ImageObject foto sumber bila tersedia;
  tidak lagi menambahkan kartu judul sintetis sebagai gambar berita pada schema.
- OpenGraph mengutamakan gambar sumber; dimensi hanya ditampilkan bila tersedia.
  Kartu 1200x630 tetap hanya fallback share bila tidak ada foto, bukan jaminan Discover.
- dateModified dihapus karena timestamp perubahan editorial yang benar belum tersedia.
- Sitemap beranda tidak lagi memakai waktu saat fungsi dijalankan sebagai lastmod;
  memakai tanggal publikasi artikel terbaru sebagai proxy, bukan waktu perubahan riil homepage.

## Batasan yang belum diselesaikan
- Dimensi/izin/akses gambar belum diverifikasi langsung. Mapping Hub belum memasok dimensi
  tervalidasi. Tidak melakukan fetch gambar acak atau scraping tambahan yang rentan SSRF.
- Poin dan metadata baru berlaku untuk artikel BARU; 100 artikel sebelumnya tidak diubah.
  Backfill perlu persetujuan terpisah agar edit manual tidak tertimpa.
- Sitemap sekarang dibatasi 5000 artikel (batas lama); sitemap index/pagination dibutuhkan
  bila jumlah artikel melampaui batas itu.
- Belum audit Core Web Vitals lapangan, Search Console, HTML Production, gambar remote,
  archive tipis, URL canonical domain produksi, akses bot dan hak gambar per sumber.
- Belum menambah AI SEO; belum ada biaya API atau ketergantungan model baru.
- Audit dependency sebelumnya masih menunjukkan 1 moderate/1 high; belum major upgrade.

## Sesudah upload Preview
1. Pastikan CONTENT_HUB_ENABLED=true, CONTENT_HUB_TRANSPORT=push tetap pada branch.
2. Redeploy Preview, bukan Production. Jangan melakukan push data tambahan dulu.
3. Uji HTML artikel nyata: canonical HTTPS domain utama, robots, OG, JSON-LD, tautan sumber.
4. Jalankan Rich Results Test dan PageSpeed Insights pada URL publik yang dapat diakses.
5. Verifikasi izin gambar, kualitas editorial dan halaman transparansi sebelum merge.

SEO bukan janji ranking atau Discover. Priority/changefreq sitemap tidak memaksa crawling
Google. Preview SSO bukan URL pengujian indeks publik atau URL canonical produksi.
