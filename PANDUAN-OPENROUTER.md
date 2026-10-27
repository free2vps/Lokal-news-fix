# Paket terbaru: OpenRouter + regional + SEO + push

Paket lengkap website ini menggantikan paket website sebelumnya. Berisi kode Next.js,
bukan database atau rahasia Hub. Upload seluruh ISI zip ke ROOT branch
integrate-content-hub di free2vps/Lokal-news-fix. Jangan upload file zip sebagai satu
berkas dan jangan bungkus isi dalam folder tambahan. Jangan upload ke main dahulu.

## Fitur yang sudah termasuk
- Endpoint push bertanda tangan, cache/lease Supabase, dedup source_url.
- Mapping meta_title/meta_description/kategori/tag hasil OpenRouter NTB.
- Fokus regional Bali–NTB–NTT dan pembacaan urutan snapshot rekomendasi tersimpan.
- SEO tahap1, NewsArticle, OG, sitemap dan kategori/tautan wilayah.
- Tidak memanggil OpenRouter dari frontend maupun Vercel importer.

## Environment Vercel Preview / branch integrate-content-hub
Pertahankan variabel Supabase yang ada dan:
CONTENT_HUB_ENABLED=true
CONTENT_HUB_TRANSPORT=push
CONTENT_HUB_PUSH_SECRET=<secret backend yang sudah disamakan dengan Hub>
Jangan mengganti secret dengan placeholder. Tidak perlu OPENROUTER_API_KEY pada
frontend atau NEXT_PUBLIC_*. Key pengayaan dipakai backend Hub di Arena.
Setelah upload, tunggu deployment branch READY. Jika perlu redeploy, pilih deployment
branch integrate-content-hub, bukan main. Jangan menonaktifkan proteksi proyek.
Tidak diperlukan migrasi Supabase tambahan untuk pembaruan OpenRouter ini.

## Batas dan status
Pengujian generasi openrouter/free telah menghasilkan metadata NTB nyata yang lolos
validasi. Pengayaan rutin Hub masih NONAKTIF. Paket website tidak mengaktifkannya.
Model router bisa berubah; harga request dibatasi nol pada kode pengirim Hub.
Sebelum push dengan AI rutin, konfigurasi/rotasi key secara aman dan aktifkan backend
Hub secara terpisah. Hal ini tidak dilakukan hanya dengan meng-upload website.
Tombol Push ada pada dashboard Hub Arena, bukan dashboard admin website Next.js.
Kode Hub tidak boleh dicampur ke root repo website.

Artikel yang sudah ada tidak diperbarui oleh impor duplikat: source_url tetap idempoten.
Mengubah metadata artikel lama membutuhkan backfill terpisah agar edit manual aman.
Preview menggunakan Supabase bersama, sehingga push data tetap dapat memengaruhi situs
utama walaupun branch belum di-merge. Deployment Production dan cron tidak diubah oleh
paket ini. Tidak ada jaminan ranking/Discover atau kapasitas model free.

## Verifikasi
1. Upload dan pastikan Preview branch READY.
2. Sebelum push tambahan, laporkan status agar konfigurasi Hub dapat diperiksa.
3. Uji satu artikel baru, periksa metadata HTML/JSON-LD dan kategori yang diterapkan.
4. Jangan menimpa env atau SQL/database lama hanya untuk memasang pembaruan ini.
