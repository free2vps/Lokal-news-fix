# Panduan Make.com — Tahap 9 (1 trigger, 05:00–23:59, maks 4 berita / 3 jam)

Jawaban singkat: **bisa.** Satu skenario Make dengan satu jadwal menjalankan dua proses berurutan —
(1) update RSS + lanjutan Hub, lalu (2) tarik maksimal 4 artikel terbit dan posting ke Facebook Page.

## Skenario utama (gabungan)
Berkas: `skenario-gabungan-3jam-05-24.blueprint.json`

| # | Modul | Panggilan |
|---|---|---|
| 1 | HTTP | `POST {HUB}/api/hub/automation?action=run` — Bearer **token otomasi** |
| 2 | HTTP | `GET {HUB}/api/hub/social?action=pull&max=4` — Bearer **token sosial** |
| 3 | Iterator | `{{2.body.items}}` |
| 4 | Facebook Pages → Create a Post | `message` = judul + ringkasan + tautan, `link` = `{{3.articleUrl}}` |
| 5 | HTTP | `POST {HUB}/api/hub/social?action=ack` — body `[{"deliveryKey":"{{3.deliveryKey}}","ok":true}]` |

Modul 1 mengerjakan seluruh rantai di Hub: RSS → profil → nilai → ringkasan → **terbit terjadwal (maks 4)** → **antrean media sosial**. Karena penerbitan kini dijalankan **sebelum** pengisian antrean, artikel yang baru terbit pada putaran itu **langsung bisa ditarik modul 2** — tidak perlu menunggu 3 jam berikutnya.

## Jadwal: 05:00 pagi sampai 24:00 (bukan 24 jam)
Di Make, interval dan jendela jam adalah dua setelan terpisah:
1. **Run scenario → At regular intervals** → **3 hours**.
2. Klik **+ Add item** pada *Advanced scheduling* → isi **Time from `05:00`** dan **Time to `23:59`**.
3. Hari: semua hari (atau Senin–Minggu sesuai kebutuhan).
4. **Time zone**: atur **organization time zone = Asia/Makassar** (Profil → Time zone options → Scenarios). Make memakai zona waktu organisasi, sedangkan Hub/Vercel mencatat UTC — jangan tertukar.

Hasilnya: **7 putaran/hari** pada 05:00, 08:00, 11:00, 14:00, 17:00, 20:00, 23:00 (waktu setempat). Tidak ada putaran 00:00–04:59. `23:59` dipakai karena jendela Make tidak menerima `24:00`.

Catatan: blueprint tidak membawa setelan jendela jam (format impor tidak menjaminnya), jadi **langkah Advanced scheduling wajib diisi manual** setelah impor.

## Bila ingin dipisah (opsional)
Dua skenario terpisah tetap disediakan: `skenario-1-otomasi-3jam.blueprint.json` dan `skenario-2-facebook-3jam.blueprint.json`. Skenario 2 dijalankan ±15 menit setelah skenario 1. Pemisahan berguna bila posting Facebook sering gagal: kegagalan posting tidak menghentikan update RSS. Konsekuensinya 2 skenario memakai kuota skenario dan tetap perlu jendela jam yang sama.

## Token
Buat di Hub → **Integrasi → Tahap 9 · Otomasi & Media Sosial**:
- **Terbitkan token otomasi** (`ISSUE AUTOMATION TOKEN`) → hanya untuk `/api/hub/automation`.
- **Terbitkan token antrean sosial** (`ISSUE SOCIAL TOKEN`) → hanya untuk `/api/hub/social` (`pull`, `ack`).

Token tampil **sekali**; Hub menyimpan hash SHA-256-nya. Simpan di header `Authorization` Make, bukan di catatan skenario yang dibagikan, bukan di GitHub/frontend.

## Kontrak endpoint
```
POST {HUB}/api/hub/automation?action=run
Authorization: Bearer <token otomasi>
→ 200 {status, intervalHours:3, approvalRemainsHuman:true, steps:[{step,ok,count,detail}], publish}
   urutan steps: rss, profiles, values, summaries, publish, social_queue

GET {HUB}/api/hub/social?action=pull&max=4
Authorization: Bearer <token sosial>
→ 200 {count, remaining, items:[{deliveryKey,title,summary,articleUrl,articleUrlSource,category,region,publishedAt,attempts}],
       deliverySemantics:"at_least_once", leaseMinutes:360}

POST {HUB}/api/hub/social?action=ack
Authorization: Bearer <token sosial>; Content-Type: application/json
Body: [{"deliveryKey":"<32 hex>","ok":true}]   (maks 10 item per panggilan)
→ 200 {delivered, failed, ignored}
```
`max` dipotong keras di 4. Endpoint menolak `403` di luar `VERCEL_ENV=preview` + `VERCEL_GIT_COMMIT_REF=webhub`, dan `401` bila token salah/dicabut.

## Biaya (7 putaran/hari)
| Komponen | Ops/putaran | Ops/bulan (×7×30) |
|---|---|---|
| Otomasi Hub (1 HTTP) | 1 | ~210 |
| Tarik antrean (1 HTTP) | 1 | ~210 |
| Posting Facebook (maks 4) | ≤4 | ≤840 |
| Ack (maks 4) | ≤4 | ≤840 |
| **Total** | **≤10** | **≤2.100** |

Masih di dalam **Core (10.000 ops)**. Paket **Free (1.000 ops)** tidak cukup walaupun hanya 7 putaran/hari. Satu skenario gabungan lebih hemat kuota skenario daripada dua (batas Free = 2 skenario aktif).

## Bila posting Facebook gagal di tengah putaran
Item yang sudah ditandai klaim tetap berstatus *claimed* 6 jam, lalu kembali ke antrean (maks 5 percobaan) — tidak hilang. Saran:
- Aktifkan notifikasi galat skenario di Make.
- Bila mau tetap meng-ack kegagalan, tambahkan **error handler "Resume"** pada modul Facebook dan modul HTTP ack dengan body `[{"deliveryKey":"{{3.deliveryKey}}","ok":false,"error":"FB_FAILED"}]` supaya item langsung dicoba lagi pada putaran berikutnya.
- Item yang habis percobaan bisa diantrekan ulang dari panel: **REQUEUE SOCIAL**.

## Yang perlu diingat
- Tidak ada artikel terbit → `count: 0`. Normal, bukan galat.
- Semantik **at-least-once**: posting sukses tetapi ack gagal dapat membuat artikel terbit dua kali. Hub tidak memverifikasi hasil ke Facebook.
- Create a Post hanya untuk **Page**, butuh izin `pages_manage_posts` + App Review/Business Verification.
- Hub tidak menyimpan token Facebook; tanpa Make berjalan, tidak ada yang dikirim.
