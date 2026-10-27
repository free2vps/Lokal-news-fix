# Pemasangan aman melalui GitHub

## 1. Buat branch baru, jangan langsung main

Repository: free2vps/Lokal-news-fix. Pilih dropdown branch main → ketik integrate-content-hub → Create branch from main. Jika branch sudah ada dari uji sebelumnya, gunakan nama baru atau cek perubahan sebelum menimpa.

## 2. Ekstrak paket lengkap

ZIP berisi folder Lokal-news-fix. Buka folder tersebut. Yang diunggah adalah ISINYA, bukan ZIP dan bukan folder pembungkus Lokal-news-fix.

Pada branch integrate-content-hub, pilih Add file → Upload files. Seret folder src, supabase, tests, docs serta file konfigurasi dari hasil ekstrak ke uploader sambil mempertahankan struktur direktori. Berkas lama pada path sama perlu diganti dengan versi baru. Jangan membuat src/src atau Lokal-news-fix/src di repository. Editor web GitHub (tekan titik pada halaman repository) bisa digunakan bila uploader tidak mempertahankan folder.

Sertakan package.json dan package-lock.json, karena paket ini menambahkan pengujian. Jangan menyertakan .env yang berisi secret, node_modules, .next, atau data/credentials.json. File .env.content-hub.example hanya template kosong, bukan secret.

Commit ke branch uji, bukan main. ZIP sendiri bukan kode yang dapat dibuild Vercel; perlu diekstrak terlebih dahulu.

## 3. Tunggu Preview Deployment

Jika Git integration mengizinkan preview branch, Vercel akan membangun deployment preview. Membuat branch saja tidak menjamin preview; lihat halaman Deployments. Jangan merge main dulu.

## 4. Konfigurasi environment PREVIEW

Di proyek lokal-news-fix-ujsf, buat/atur hanya target Preview, dan batasi ke branch uji jika opsi tersebut tersedia:

- CONTENT_HUB_ENABLED=true
- PORTAL_HUB_URL = origin HTTPS preview Content Hub port 3000, tanpa /api dan bukan localhost
- PORTAL_API_TOKEN = token portal backend, bukan password admin

Pastikan environment Supabase dan CRON_SECRET yang sudah ada tersedia juga di Preview. Jangan mengirim nilai secret ke chat. Setelah mengubah environment, redeploy preview.

## 5. Database

Migrasi tambahan SUDAH dijalankan pada Supabase Lokal News dan diverifikasi. Tidak perlu menjalankan ulang SQL untuk proyek tersebut. Tidak ada artikel/snapshot yang diimpor pada langkah migrasi.

PERHATIAN: preview dan produksi yang memakai Supabase sama akan berbagi tabel/data. Uji impor berikutnya akan menulis artikel baru. Sebelum memanggil /api/cron, pastikan Anda menyetujui dampak itu atau gunakan database staging.

## 6. Beri tahu assistant setelah upload selesai

Kirim nama branch atau URL Preview Deployment. Assistant dapat memeriksa status build melalui konektor Vercel. Jangan kirim token. Selanjutnya validasi runtime dan impor pertama secara terkendali. Baru merge ke main setelah hasil sesuai.

## Batasan

Backend Content Hub masih sandbox sementara. Website dapat menyajikan data Supabase terakhir saat sandbox mati, tetapi tidak bisa mengambil konten baru dari sandbox yang tidak hidup. Upgrade hosting kolektor tetap diperlukan untuk operasi jangka panjang.

Audit dependensi memiliki temuan Next/PostCSS yang belum diselesaikan lewat upgrade major. Baca README-CONTENT-HUB.md sebelum peluncuran publik.
