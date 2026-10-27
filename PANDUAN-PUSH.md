# Integrasi PUSH — menggantikan panduan pull sebelumnya

Status: kode siap dan diuji lokal; BELUM di-upload/deploy atau diuji dengan impor nyata.
Tidak perlu migrasi SQL baru: migrasi cache/lease sebelumnya tetap dipakai.

## 1. Upload website
Ekstrak lokal-news-fix-push.zip. Upload isinya ke root branch integrate-content-hub,
bukan main; jangan membungkus semua berkas dalam folder tambahan.

## 2. Buat secret baru sendiri
Buat satu secret acak minimal 32 karakter (disarankan 32 byte acak, hex 64 karakter).
Contoh di terminal pribadi: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Jangan kirim hasilnya ke chat atau commit GitHub.

Vercel > Environment Variables, khusus Preview / branch integrate-content-hub:
CONTENT_HUB_ENABLED=true
CONTENT_HUB_TRANSPORT=push
CONTENT_HUB_PUSH_SECRET=<secret baru>
Supabase environment yang ada tetap dipakai. Jangan ubah Production.
PORTAL_HUB_URL dan PORTAL_API_TOKEN tidak digunakan untuk pull saat mode push aktif.
Redeploy deployment branch integrate-content-hub setelah env diperbarui.

## 3. Konfigurasi pengirim Hub
Skrip pengirim sudah ditambahkan ke workspace Content Hub pada scripts/push-vercel.js.
Tambahkan di portal-content-hub/.env (backend saja, bukan GitHub):
CONTENT_HUB_PUSH_URL=https://lokal-news-fix-ujsf-git-integrate-content-hub-free2vps.vercel.app/api/content-hub/push
CONTENT_HUB_PUSH_SECRET=<secret yang sama>

PENTING: preview Vercel sebelumnya dilindungi SSO. Push tidak melewati SSO secara otomatis.
Jika perlindungan aktif, gunakan fitur Protection Bypass for Automation Vercel jika
tersedia pada akun, kemudian simpan secret bypass di .env Hub sebagai:
VERCEL_AUTOMATION_BYPASS_SECRET=<secret bypass Vercel>
Ini berbeda dari secret HMAC dan password admin. Pengirim memakai header resmi
x-vercel-protection-bypass; tidak menaruh secret di URL. Jangan menonaktifkan proteksi
seluruh proyek hanya untuk mencoba. Bila fitur bypass tidak tersedia, berhenti dan
laporkan: pengujian end-to-end Preview masih terblokir; jangan klaim integrasi selesai.

## 4. Satu kali push
Pastikan Hub berjalan di port 3000. Dari folder portal-content-hub:
node scripts/push-vercel.js
Tidak perlu npm script jika package.json lama; jalankan node langsung.
Skrip mengambil snapshot lokal tanpa scraping baru, menandatangani body, dan mengirim
sekali ke Vercel. Tidak ada retry otomatis atau scheduler baru.
HTTP 200 berarti proses berhasil; 207 berarti ada kegagalan parsial yang perlu dibaca;
401 JSON dari endpoint berarti signature/secret/waktu tidak cocok. HTML/redirect
biasanya perlindungan Preview atau tujuan salah. Kirim ringkasan tanpa secret.

## 5. Verifikasi
Buka /api/content-hub?type=recommended&limit=2 melalui browser yang login Vercel.
Impor memakai Supabase bersama: artikel valid dapat tampil di situs utama walaupun
branch belum di-merge. Uji satu kali dahulu. Dedup source_url/lease tetap aktif;
replay dalam jendela 5 menit bisa diproses ulang, tetapi artikel tidak digandakan.
Payload lama/kosong tidak sengaja menghapus snapshot terakhir.

## Perubahan perilaku
Dalam mode push tombol Sync dan cron tidak menarik URL Arena lagi; menunggu push.
Tidak ada fallback AI/scraping lama. Pengumpulan dan pengiriman baru tetap memerlukan
Hub hidup; ini BUKAN solusi hosting 24/7. Frontend tetap membaca Supabase saat Hub mati.

## Pengamanan
HMAC-SHA256 body + timestamp, toleransi 5 menit, secret minimal 32 karakter,
batas body 3 MB, maksimal 100 kandidat artikel, validasi pemetaan dan timestamp sumber,
lease database dan deduplikasi source_url. URL tujuan pengirim dibatasi HTTPS *.vercel.app,
tanpa redirect, kredensial URL atau port khusus. Endpoint tidak menerima URL fetch.
