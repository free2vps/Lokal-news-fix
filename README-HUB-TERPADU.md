# Content Hub + website — tahap awal implementasi

**Status: fondasi lokal, belum siap Production.** Atas permintaan pemilik, kode ini dapat ditinjau pada branch Preview setelah mengikuti `PANDUAN-BRANCH-PREVIEW.md`; fungsi Hub lama belum semuanya terintegrasi. Jangan merge/promote ke Production, memigrasikan database, mengaktifkan cron/push/sosial, memasukkan API key produksi, atau menghubungkan Hub ke database nyata tanpa peninjauan dan izin terpisah. Preview website dapat memakai Supabase bersama, jadi periksa environment sebelum membukanya. Production dan cron Production lama **tidak diubah** oleh pekerjaan lokal ini.

## Yang telah dibuat

- `/admin` memakai kerangka dashboard Hub dan login sendiri. Sesi disimpan sebagai hash di database dan diberikan hanya melalui cookie HttpOnly; perubahan memeriksa asal dan header CSRF. Batas percobaan login saat ini bersifat global di database; ini belum menggantikan rate limit edge dan audit keamanan untuk Production. Pada Vercel Preview tanpa konfigurasi database Hub, tersedia tampilan statis khusus untuk meninjau menu dan sumber publik; tampilannya bukan login atau sistem operasional.
- Skema Hub libSQL dan inisialisasi **database lokal baru**. Database, akun, secret, dan data Hub lama tidak disalin ke paket ini. Tidak ada akun default.
- Manifest 11 situs pemerintah NTB serta seed yang bisa dijalankan berulang tanpa mengganti edit manual atau menambahkan URL yang sama. Dashboard juga dapat menambahkan sumber secara manual sebagai nonaktif dan belum terverifikasi, tanpa melakukan request jaringan. Kemungkinan sumber lain pada domain pemerintah yang sama dilaporkan untuk ditinjau, bukan otomatis digabungkan.
- Semua sumber baru **nonaktif**, berjenis `government_website`, format `unverified`, hak `unknown`. HTML tidak disebut RSS. Tidak ada feed pemerintah yang terverifikasi pada pemeriksaan awal.
- Parser **offline** khusus daftar Lombok Timur berdasarkan pola tautan yang terlihat; hanya membaca judul dan tautan, tanpa membuka artikel atau mengarang tanggal. Pemanggilan jaringan dan kolektor belum dihubungkan. Sebagian situs lain merespons 403, memiliki masalah sertifikat, atau tidak selesai diperiksa; lihat `docs/AUDIT-SUMBER-NTB.md`.
- Aturan kandidat dan revisi yang diuji secara lokal: item berulang dalam sumber yang sama memakai identitas stabil; edit editorial dipertahankan; perubahan yang berpengaruh membatalkan persetujuan; konflik identitas dikarantina. URL yang sama pada sumber berbeda ditandai, bukan otomatis digabung atau dihapus. Tanggal penemuan tidak dijadikan tanggal terbit.
- Persetujuan disimpan per versi sebagai snapshot; ada fondasi antrean publikasi idempoten dan nonce untuk anti-replay. **Tidak ada worker penerbitan, penerima kolektor, atau pengiriman sosial aktif.** Persetujuan di dashboard tidak menerbitkan artikel.
- Panel AI dapat menyimpan model dan, bila master key backend disiapkan, API key terenkripsi; kunci tidak dikembalikan ke browser. OpenRouter dibatasi model berakhiran `:free`. Tidak ada pemanggilan AI, failover, atau pengujian provider aktif; Cohere hanya direncanakan untuk evaluasi.
- Pada salinan ini cron, push, webhook sosial dan API Hub publik lama ditutup sementara agar tidak melewati persetujuan. `vercel.json` di salinan ini tidak menjadwalkan cron. Ini **tidak menonaktifkan** cron atau webhook pada deployment Production yang sudah ada.
- Komponen beranda, header, footer, feed, halaman artikel dan CSS website yang diterima tetap sama; layout publik dipindahkan ke route group untuk memisahkan layout admin. Perubahan tersebut harus dites lagi dengan data nyata yang disetujui sebelum rollout. File backend Hub lokal asli disertakan sebagai referensi di `references/legacy-hub/`, tanpa data, key atau koneksi otomatis ke Next.js.

## Belum selesai

Kolektor dan adapter untuk 10 situs lainnya; akses/izin dan tanggal sumber; pemecahan konflik identitas melalui dashboard; manajemen sumber penuh; RSS lama dan migrasi data Hub; rekomendasi; X Trends24 dan YouTube; sync logs; pengaturan/backup; AI router dan batas kuota; migrasi Turso; ledger dan transaksi publikasi Supabase; worker outbox; replay protection yang digabung secara atomik dengan penerimaan batch; pengujian keamanan dan integrasi lintas database; adaptasi website dan Hub ke PHP. Menu yang belum terhubung diberi label, bukan memakai data contoh.

Jangan menjanjikan siklus dua jam atau publikasi otomatis sampai platform dan sumber mengizinkan, mekanisme job andal tersedia, dan pemilik menyetujuinya. Periksa khusus kebijakan Vercel sebelum menentukan tempat pengambilan RSS/HTML. Hak menyalin artikel lengkap belum dikonfirmasi.

## Menjalankan hanya secara lokal

Persyaratan Node.js 20.18.1 atau lebih baru. Contoh ini membuat database **baru yang terisolasi**, bukan migrasi data lama:

```bash
npm ci
npm run hub:init-local
umask 077
node -e "require('fs').writeFileSync('data/hub-setup-token',require('crypto').randomBytes(32).toString('base64url'),{mode:0o600})"
# Tampilkan token hanya di komputer pribadi Anda, lalu buat password di /admin.
cat data/hub-setup-token
HUB_DATABASE_URL="file:$PWD/data/hub-local.db" \
HUB_ALLOW_LOCAL_DB=true HUB_LOCAL_PREVIEW=true \
HUB_SETUP_TOKEN="$(cat data/hub-setup-token)" \
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Dalam mode preview lokal saja, `/` dialihkan ke `/admin`; tampilan publik normal tidak diubah. Token setup hanya untuk akun pertama; simpan privat dan hapus setelah setup. Jangan pakai token contoh atau database file lokal pada Vercel. Direktori `data/` dikecualikan dari Git dan paket; buat backup yang konsisten jika data lokal mulai penting. **Jangan masukkan API key nyata ke preview sementara.** Master key enkripsi perlu disimpan dengan aman dan dibackup terpisah; fitur AI belum beroperasi.

## Pemeriksaan

```bash
npm test
npx tsc --noEmit --incremental false
```

Tes lokal memakai fixture dalam database sementara, bukan berita yang ditampilkan ke pengguna. Build di workspace telah diuji dengan URL Supabase `127.0.0.1:9` dan kunci dummy **khusus pengujian offline** sehingga tidak menyentuh database nyata; hasil build tersebut bukan artifact deployment. UI lokal diuji pada ukuran desktop dan mobile. Salinan ini tetap memerlukan uji ulang dan peninjauan sebelum penggunaan nyata.
