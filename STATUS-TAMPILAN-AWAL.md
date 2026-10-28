> **Arsip proyek lama:** petunjuk di bawah belum berlaku untuk Hub terpadu tahap awal. Route otomatis/push lama dinonaktifkan dalam salinan ini. Jangan gunakan instruksi arsip ini untuk deployment atau operasi. Untuk peninjauan branch Preview baca `PANDUAN-BRANCH-PREVIEW.md`; untuk batasan sistem baca `README-HUB-TERPADU.md`.

# Tampilan awal dipulihkan

27 Oktober 2026: header, beranda (carousel/sorotan, sidebar, video, blok kategori), ukuran feed, dan penempatan slot iklan dikembalikan ke versi sebelum redesign compact.

Perbaikan integrasi Content Hub, metadata SEO, kategori kontekstual PPPK, validasi/dedup/pagination, serta patch dependency dipertahankan. Data berita tetap memakai cache asli dan dapat berbeda dari tampilan sebelumnya.

23 tes website, typecheck, dan production build berhasil. Preview lokal tersedia pada port 3001. Perubahan pemulihan ini belum diunggah ke GitHub atau dideploy ke Vercel.

Gunakan paket `lokal-news-tampilan-awal.zip`, bukan paket `lokal-news-preview-compact.zip` sebelumnya. Upload hanya ke branch integrasi bila nanti sudah disetujui; jangan langsung ke main.

Pembaruan: E2E SEO OpenRouter sudah lulus dan pengaturan AI/failover Hub tersedia. Groq/Cohere nyata memerlukan key pengguna; Cohere hanya evaluasi. Lihat PANDUAN-AI-DASHBOARD-E2E.md untuk status lengkap dan catatan Preview lama. Canonical Production telah diperbaiki melalui environment dan redeploy commit Production lama sesuai persetujuan pengguna; tindakan pemulihan tampilan ini tidak mengubah Production.
