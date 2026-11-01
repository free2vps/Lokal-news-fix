> **Arsip proyek lama:** petunjuk di bawah belum berlaku untuk Hub terpadu tahap awal. Route otomatis/push lama dinonaktifkan dalam salinan ini. Jangan gunakan instruksi arsip ini untuk deployment atau operasi. Untuk peninjauan branch Preview baca `PANDUAN-BRANCH-PREVIEW.md`; untuk batasan sistem baca `README-HUB-TERPADU.md`.

# Pembaruan RSS dan Mistral SEO (menggantikan aturan minimal 500 karakter sebelumnya)

## RSS
15 sumber permintaan pengguna terdaftar pada database Hub lokal (total 59 sumber).
7 feed segar tervalidasi dan aktif untuk sinkronisasi selanjutnya:
- Suara NTB: https://suarantb.com/feed/
- Koran NTB: https://koranntb.com/feed/
- NTB Post: https://www.ntbpost.com/feeds/posts/default
- Kabar NTB: https://kabarntb.com/feed/
- NusaBali: https://www.nusabali.com/rss
- Bali Puspa News: https://www.balipuspanews.com/feed
- Bali Portal News: https://baliportalnews.com/feed/

Radar NTB /feed/ valid tetapi stale, nonaktif.
Bali Post timeout/404 pada kandidat yang dicoba; BeritaBali, VoxNTT dan Victory News
403; AFBTV Kupang, nerantt.com (label NeraFlores dari pengguna), Harian Flores 404 pada
kandidat. Ketujuhnya terdaftar nonaktif; bukan klaim situs tersebut tidak punya RSS.
Tidak menembus proteksi, login, atau melakukan scraping artikel penuh.
UNTESTED pada sumber aktif berarti validasi RSS/dates berhasil tetapi pipeline
pengumpulan artikel lengkapnya belum dijalankan. Tidak ada push Supabase pada tahap ini.
Detail pemeriksaan: requested-rss-validation.json (bukan daftar URL yang dijamin abadi).
Skrip pendaftaran idempoten: scripts/register-requested-rss.js.

## Mistral SEO-only NTB
Input minimal kini judul 15 karakter dan cuplikan 80 karakter, bukan 500.
Output hanya meta_title, meta_description, kategori dari whitelist, dan tag sumber.
Judul artikel, ringkasan, tanggal, URL sumber dan klasifikasi wilayah TIDAK diubah AI.
Saran kategori dipetakan ke kategori website; aturan kategori lokal tetap dapat
menimpa saran AI. Input pendek tidak dipaksa mencapai 155 karakter atau dibuat 5W+1H.
Pemeriksaan panjang/angka/tag/kosakata tetap berlaku; bukan jaminan kebenaran model.
Cache versi ntb-seo-v2, timeout, batas batch/harian dan fallback tetap berlaku.

Uji API nyata satu artikel NTB 120 karakter sudah dicoba: HTTP 429.
Tidak ada hasil metadata AI nyata yang diterima; sumber/ringkasan tetap utuh.
429 menunjukkan pembatasan penggunaan/rate/quota, bukan bukti akun free pasti tidak
mendukung API. Perlu melihat Limits/Usage akun. Tidak melakukan retry otomatis.
MISTRAL_NTB_ENABLED tetap false sampai akses generasi berhasil.
Tes dengan respons mock memastikan metadata/kategori NTB cuplikan pendek diterima.

## Deployment
Hub pada workspace memakai kode baru; database sumber lokal tidak otomatis ikut zip.
Website pendamping perlu upload isi lokal-news-rss-seo.zip ke root branch Preview
integrate-content-hub lalu deploy. Jangan main/Production dahulu.
Tidak ada migrasi Supabase baru. Artikel lama/source_url duplikat tidak ditimpa;
metadata Mistral untuk artikel lama butuh backfill terpisah agar edit manual aman.
Paket Hub tidak berisi data/credentials/.env/key. Jangan mengganti .env atau database
aktif dengan paket. Rotasi key dan bypass yang pernah dibagikan di chat.
