# Website + Content Hub — paket branch Preview

**Status: integrasi masih bertahap; bukan versi Production.** Paket ini memuat seluruh kode proyek website terpadu yang tersedia saat ini, beserta salinan kode backend Hub Arena yang sudah berfungsi secara lokal sebagai referensi. Backend Hub lama **belum seluruhnya terhubung** ke `/admin` Next.js.

## Mulai dari sini

Baca **[PANDUAN-BRANCH-PREVIEW.md](PANDUAN-BRANCH-PREVIEW.md)** sebelum mengunggah. Kode website kini memakai `src/app/(public)`: 12 file di lokasi lama perlu dipindahkan/dihapus dari **branch Preview saja**, jika tidak Next.js dapat menemukan dua halaman untuk URL yang sama. Jangan sekadar menambahkan ZIP atau mengunggah folder di dalamnya ke repository lama.

- Website publik memakai Supabase. Environment Vercel Preview bisa saja menunjuk Supabase yang sama dengan Production, sehingga data nyata dapat terlihat di Preview. Tinjau environment sebelum membuka atau membagikan Preview.
- Jika Preview tidak memiliki `HUB_DATABASE_URL`, `/admin` menawarkan **pratinjau visual statis**: menu dan 11 sumber dari file konfigurasi, tanpa login operasional, database Hub, sinkronisasi, atau penyimpanan. Ini bukan data contoh dan bukan backend Hub yang sudah selesai.
- Kode yang sudah dipindahkan mencakup fondasi sesi, sumber, revisi/editorial, dan konfigurasi AI. Kolektor, migrasi Hub lama, rekomendasi, X, YouTube, AI runtime, sinkronisasi, dan publikasi masih perlu diintegrasikan.
- Kode Hub lama yang berfungsi di Arena disimpan di `references/legacy-hub/`, **sebagai referensi**; tidak dijalankan otomatis di Vercel. Database lama, `.env`, master key, API key, dan sesi tidak disertakan.
- Seluruh 11 situs resmi NTB ada di `config/ntb-government-sources.json`; status awal nonaktif. Akses, RSS, tanggal dan hak penggunaan belum seluruhnya terverifikasi.

**Jangan merge atau promote ke Production.** `vercel.json` pada branch ini berisi cron kosong dan route cron, push, serta webhook sosial lama ditutup di kode baru. Hal itu tidak membuktikan cron pada Production lama berhenti. Lihat `README-HUB-TERPADU.md` untuk rincian implementasi dan `STATUS-HUB-TERPADU-TAHAP-AWAL.md` untuk hasil pemeriksaan.
