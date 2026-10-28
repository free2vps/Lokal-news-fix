> **Arsip proyek lama:** petunjuk di bawah belum berlaku untuk Hub terpadu tahap awal. Route otomatis/push lama dinonaktifkan dalam salinan ini. Jangan gunakan instruksi arsip ini untuk deployment atau operasi. Untuk peninjauan branch Preview baca `PANDUAN-BRANCH-PREVIEW.md`; untuk batasan sistem baca `README-HUB-TERPADU.md`.

# Bali–NTB–NTT + Mistral NTB

## Status
Kode Hub aktif lokal; API rekomendasi sudah memakai prioritas regional.
Mistral BELUM aktif: API key tidak tersedia. Tidak ada panggilan API Mistral nyata.
Tidak ada push Supabase baru, deployment Vercel, backfill artikel lama atau aktivasi cron.

## Kebijakan rekomendasi
- Klasifikasi memakai judul/teks, bukan lokasi penerbit. Bukti: satu istilah wilayah
  pada judul atau sedikitnya dua istilah berbeda pada teks sumber.
- Utama: Bali, NTB, NTT. Wilayah tidak jelas tidak masuk rekomendasi.
- Nasional: konten eksplisit nasional, disisipkan maksimal satu per empat item regional.
  Feed utama 20 item: maksimal 4 nasional bila stok cukup; bukan jaminan komposisi tiap
  potongan pagination arbitrer. Tidak mengisi kekurangan regional dengan nasional.
- 60 berita : 40 hiburan adalah target lunak di dalam stok regional, bukan alasan
  mengimpor hiburan nasional berlebihan. Prioritas wilayah lebih tinggi.
- Playlist tetap snapshot terpisah, bukan artikel regional. X tetap Trends24 terpisah.
- Klasifikasi berbasis aturan bisa salah terutama nama ambigu. Ini belum fact-checking,
  perlu audit editorial, bukan klaim akurasi sempurna.

## Sumber
Dua sumber tambahan terdaftar lokal: ANTARA Bali dan ANTARA NTT (total menjadi 44).
HTTP 200, RSS terurai dan masing-masing 20 tanggal artikel segar tervalidasi.
Belum harvest; status UNTESTED menandakan pipeline artikel lengkap belum diuji.
Skrip idempoten: node scripts/add-regional-sources.js
Sumber lama tidak dihapus/diubah menjadi daerah hanya karena penerbitnya lokal.

## Pengayaan Mistral
Lokasi: src/services/mistralNtb.js; dipanggil scripts/push-vercel.js sebelum push.
Hanya kind=article, contentGroup=news, primaryRegion=ntb. Artikel lintas wilayah,
Bali/NTT/nasional, editorial_summary manual dan teks kurang dari 500 karakter dilewati.
Input hanya judul + teks RSS tersedia, maksimal 6000 karakter. Tidak mengambil full
article tambahan. Panggilan 20 detik, maksimal 5 request per push (konfigurabel 0–10)
dan default maksimal 20 percobaan per hari UTC (konfigurabel 0–100).
Batas ini BUKAN jaminan biaya tertentu; cek tarif dan kuota akun Mistral sendiri.
Cache SQLite memakai artikel+teks+model+versi. Lease processing lokal mencegah panggilan
bersamaan untuk cache key sama. Error ditunda satu jam dan hasil deterministik dipakai.
Cache dan percobaan dibuat additif pada database Hub saat pengayaan pertama dijalankan;
Supabase tidak membutuhkan migrasi baru.

Hasil: judul, ringkasan, heading, poin penting, meta title/deskripsi dan tag. Tanggal,
URL sumber dan kategori asli tidak diubah oleh Mistral. Pemeriksaan panjang, angka,
tag yang ada di sumber dan kemiripan kosakata adalah guardrail, bukan bukti kebenaran.
Preview dashboard rekomendasi masih menampilkan hasil deterministik; hasil Mistral
tersedia pada payload yang dipush dan cache ntb_ai_cache, bukan layar editor AI baru.

## Konfigurasi backend Hub (bukan Vercel frontend)
MISTRAL_NTB_ENABLED=true
MISTRAL_API_KEY=<key pribadi, jangan commit/tempel ke chat>
MISTRAL_MODEL=mistral-small-latest
MISTRAL_NTB_BATCH_LIMIT=5
MISTRAL_NTB_DAILY_LIMIT=20

Jangan aktifkan sebelum key/kuota dan pembatasan akun diperiksa. Arena bukan penyedia
API backend gratis. Bila pengguna tidak bisa mengedit .env, assistant dapat mengatur
melalui alat workspace setelah key disediakan lewat mekanisme konfigurasi yang sesuai.
Jangan masukkan secret ke paket atau browser/localStorage.

## Website pendamping
Upload lokal-news-regional-ntb.zip ke root integrate-content-hub, bukan main.
Ini paket lengkap, mencakup SEO tahap1 + push, tanpa secret. Pertahankan env Preview.
Tambahan: wilayah Bali/NTT, mapping metadata Mistral, label tidak lagi selalu tanpa AI,
getLatest Hub mengikuti urutan snapshot rekomendasi yang tersimpan (maksimal 100
kandidat terakhir) bukan semua artikel lama diurutkan nasional terbaru. Halaman
artikel lama tetap dapat diakses dan sitemap tetap memuat arsip; tidak menghapus data.
Heading/metadata baru hanya tersimpan untuk artikel baru. Artikel duplikat source_url
masih diabaikan, termasuk 100 artikel lama: backfill perlu persetujuan dan perlindungan
edit manual terpisah. Nasional relevan khusus daerah belum punya label dampak tersendiri.

## Urutan berikutnya
1. Upload dan deploy website pendamping pada Preview.
2. Siapkan API key secara aman; aktifkan Mistral hanya bila ada kuota.
3. Uji satu batch terbatas dan tinjau editorial hasil nyata sebelum memperluas.
4. Sinkron sumber regional baru dan push dilakukan terpisah, bukan otomatis oleh dokumen.
5. Audit tampilan beranda: hero mengutamakan wilayah, tetapi filter section/keberadaan
   gambar dapat membuat persentase visual berbeda. Batas 20% berlaku pada feed Hub,
   bukan janji seluruh komponen UI 80:20. Tidak mengubah desain saat ini.
6. Rotasi bypass token yang sebelumnya dibagikan; jangan tunggu Production.
