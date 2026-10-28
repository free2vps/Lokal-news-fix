# Status pembuatan Content Hub terpadu — tahap awal

**Tanggal:** 27 Oktober 2026, WITA  
**Lokasi kode:** `/home/user/lokal-news-terpadu`  
**Status:** fondasi lokal telah dibuat dan diuji. **Belum lengkap dan belum siap Production.** Setelah laporan awal ini, pemilik meminta paket untuk ditinjau pada branch Preview; baca `PANDUAN-BRANCH-PREVIEW.md`.

## Yang sudah dikerjakan

1. Mengganti kerangka `/admin` pada salinan proyek dengan dashboard Hub di dalam proyek website. Tampilan beranda, komponen utama, halaman artikel, dan CSS publik yang diperiksa tetap sama; layout admin dipisahkan.
2. Membuat database Hub lokal baru, skema libSQL, login, sesi HttpOnly, perlindungan CSRF, dan batas percobaan login berbasis database. Database ini terisolasi dari Supabase dan Hub lama.
3. Mendaftarkan 11 sumber resmi NTB di database lokal sebagai **situs nonaktif dan belum terverifikasi**, bukan RSS. Pengulangan seed menghasilkan 0 sumber baru dan 11 yang sudah ada. Dashboard dapat mencatat sumber lain secara manual tanpa mengaksesnya; sumber baru selalu nonaktif.
4. Membuat fondasi deduplikasi per identitas sumber, penyimpanan atribusi, penanda kemungkinan duplikat lintas sumber, edit manual dengan pemeriksaan versi, serta persetujuan per revisi. Rekaman yang meragukan tidak digabung atau dihapus otomatis.
5. Membuat fondasi outbox idempoten dan ledger nonce; keduanya belum terhubung ke penerimaan kolektor atau worker penerbitan. Tidak ada artikel yang dipublikasikan.
6. Membuat panel untuk mencatat model dan API key terenkripsi jika master key backend tersedia. Pemanggilan AI, failover, dan pengaturan kuota belum terhubung; pratinjau tidak disiapkan untuk menerima API key sungguhan.
7. Menutup route cron, push, API Hub publik, dan webhook sosial **pada salinan kode ini** hingga alur baru aman. Tidak ada perubahan pada deployment, database, atau cron Production yang sudah ada.

## Hasil pemeriksaan 11 sumber

Pemeriksaan akses ini dilakukan satu kali dari lingkungan kerja pada 27 Oktober 2026. Kegagalan dari lingkungan ini belum tentu berarti situs tidak bisa diakses dari tempat lain. Tidak ada halaman artikel penuh yang diambil dan tidak ada RSS yang berhasil diverifikasi.

| Sumber | URL yang diminta | Hasil awal |
|---|---|---|
| Provinsi NTB | https://ntbprov.go.id/ | Rantai sertifikat HTTPS tidak dapat diverifikasi. |
| Lombok Barat | https://portal.lombokbaratkab.go.id/jelajah/artikel/ | Rantai sertifikat HTTPS tidak dapat diverifikasi. |
| Lombok Tengah | https://www.lomboktengahkab.go.id/ | `robots.txt` 404; halaman 403. |
| Lombok Timur | https://portal.lomboktimurkab.go.id/semua-berita.html | Halaman HTML 200; pola judul/tautan ditemukan. Tanggal terbit tidak terlihat di hasil ekstraksi daftar. |
| Lombok Utara | https://lombokutarakab.go.id/ | Pemeriksaan aturan akses melewati batas waktu. |
| Sumbawa | https://setda.sumbawakab.go.id/berita/ | Aturan akses tersedia; halaman merespons 403/perlindungan otomatis. |
| Sumbawa Barat | https://prokopim.sumbawabaratkab.go.id/category/berita/ | Pemeriksaan aturan akses melewati batas waktu. |
| Dompu | https://diskominfo.dompukab.go.id/berita | `robots.txt` merespons 403; halaman tidak diperiksa oleh skrip. |
| Kabupaten Bima | https://diskominfostik.bimakab.go.id/id/news?sort=latest | `robots.txt` merespons 403; halaman tidak diperiksa oleh skrip. |
| Kota Mataram | https://web.mataramkota.go.id/news/ | `robots.txt` merespons 403; halaman tidak diperiksa oleh skrip. |
| Kota Bima | https://kominfotik.bimakota.go.id/ | `robots.txt` merespons 403; halaman tidak diperiksa oleh skrip. |

Pemeriksaan tambahan terbatas pada daftar Lombok Timur menemukan 30 judul/tautan dalam hasil ekstraksi. Parser khusus telah dibuat untuk membaca pola tersebut **secara offline**, tetapi belum ada pengumpulan otomatis atau penentuan tanggal terbaru. Aturan akses, kesegaran, dan hak penggunaan setiap sumber masih perlu dicek ulang sebelum pengumpulan.

## Pengujian

- Pada tahap awal laporan, **41 tes otomatis lulus**, termasuk seed berulang, penambahan sumber yang nonaktif, duplikat, perlindungan edit manual, persetujuan, outbox, sesi, CSRF, enkripsi, dan anti-replay. Setelah penambahan pengujian mode Preview, total terbaru **42 tes lulus**.
- TypeScript lulus; build Next.js lulus menggunakan konfigurasi Supabase lokal dummy yang tidak menyentuh database nyata. Artifact build bukan untuk deployment.
- Uji browser lokal desktop dan mobile: login, tampilan 11 sumber, halaman berita kosong, status AI nonaktif, dan logout berhasil. Ada peringatan WebSocket HMR pada mode pengembangan; bukan uji Production.
- Audit dependency runtime: 0 kerentanan dilaporkan pada saat pemeriksaan.

## Belum operasional dan langkah berikutnya

Integrasi kolektor, sebagian besar adapter situs, manajemen sumber penuh, migrasi data Hub lama, rekomendasi, X, YouTube, sync logs, router AI, backup, ledger Supabase, worker publikasi, dan adaptasi PHP masih perlu dibuat dan diuji. Sebelum pengambilan terjadwal atau deployment, perlu memastikan kebijakan platform dan sumber, membuat backup/restore yang konsisten, menyelesaikan persetujuan tiap revisi, dan meminta izin terpisah untuk tindakan live.

**Jangan merge atau promote ZIP tahap ini ke Production.** Pemilik dapat meninjau branch Preview sesuai `PANDUAN-BRANCH-PREVIEW.md`, dengan memperhatikan database yang mungkin dipakai bersama. Database lokal, kredensial, file `.env`, dependency terpasang, dan build tidak disertakan. Langkah lokal dan batasannya ada pada `README-HUB-TERPADU.md`.
