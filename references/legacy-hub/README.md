# Referensi: kode Content Hub yang berjalan di Arena

Folder ini menyimpan salinan kode backend Express/SQLite, dashboard, layanan AI, RSS, X, YouTube, rekomendasi, pengaturan, push, dan tes dari Hub lokal yang telah disusun sebelumnya. Folder ini disertakan supaya kode fungsional lama tidak hilang saat penggabungan.

**Penting:** folder ini adalah referensi, bukan backend `/admin` Next.js. Folder ini tidak di-import oleh proyek website dan tidak dijalankan oleh konfigurasi Vercel. Menyertakan berkasnya **tidak** membuat seluruh fitur Hub lama otomatis berfungsi pada Preview.

Jangan menjalankan `server.js`, mengaktifkan scheduler, menjalankan push, atau menghubungkan folder ini ke layanan nyata pada Preview ini. Implementasi lama memakai SQLite lokal/file, timer dalam proses, cleanup berdasarkan umur dan jalur publish yang belum menggunakan persetujuan revisi baru; bagian-bagian itu perlu diadaptasi dan diaudit sebelum dipakai di Vercel.

Database Hub lama, file `.env`, master key, API key, sesi, `node_modules`, laporan, dan snapshot konten **tidak disertakan**. Fitur yang bergantung pada data dan rahasia tersebut tidak akan menyala hanya dengan mengunduh folder ini. Migrasi data serta penerapan otomatisasi memerlukan backup dan persetujuan terpisah.
