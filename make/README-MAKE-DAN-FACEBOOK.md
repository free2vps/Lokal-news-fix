# Hubungkan Make.com + Facebook Page

Panduan ini **tidak menambah kode baru**. Semua yang dibutuhkan sudah ada di Hub:
antrean media sosial (`hub_social_queue_v2`), penarikan bertoken, dan konfirmasi kirim.

Yang Anda lakukan hanya menyalakan jalurnya.

---

## Gambaran singkat

```
Redaktur otomatis (GitHub tiap jam)  →  8 berita terbit
                                        ↓ otomatis masuk ANTREAN
Make.com (tiap 3 jam)  →  ambil 2 dari antrean  →  posting ke Facebook  →  lapor "sudah"
```

Hub **tidak menyimpan token Facebook**. Token Facebook hanya ada di dalam Make.
Kalau skenario Make dimatikan, berita tetap terbit di portal — hanya tidak diposting ke Facebook.

---

## Langkah 1 — Buat token di Hub

1. Buka **Hub → API Integration** (atau menu media sosial)
2. Jalankan berurutan:
   - `prepare` (siapkan tabel antrean) → konfirmasi **PREPARE SOCIAL**
   - `issueToken` (buat token) → konfirmasi **ISSUE SOCIAL TOKEN**
3. **Salin token yang muncul SEKALI itu saja** — Hub tidak menampilkannya lagi.

Token ini bernilai seperti kata sandi. Jangan tempel di chat, jangan simpan di repo.

---

## Langkah 2 — Impor skenario ke Make

Berkas: **`make/skenario-facebook-hemat-kuota.blueprint.json`**

1. Make → **Scenarios** → **Import blueprint** → pilih berkas itu
2. Setelah terbuka, ganti dua hal:
   - `GANTI_TOKEN_SOSIAL` → token dari Langkah 1 (ada di 2 tempat: modul 1 dan modul 4)
   - `PILIH_HALAMAN_FACEBOOK_ANDA` → sambungkan akun Facebook Anda, lalu pilih halaman
3. Nyalakan skenario

### Jadwal

Bawaan: **tiap 180 menit** (3 jam). Bisa diubah di **Run scenario → At regular intervals**.

---

## Kenapa hanya 2 berita per putaran

Kuota gratis Make adalah **1.000 operasi/bulan**. Satu putaran memakai:

| Langkah | Operasi |
|---|---|
| Ambil antrean (HTTP) | 1 |
| Posting Facebook | 1 per berita |
| Lapor "sudah" (HTTP) | 1 |

| Setelan | Operasi/bulan | Muat gratis? |
|---|---|---|
| Tiap 3 jam, **2** berita | 7 putaran × 4 = **~840** | ✅ ya |
| Tiap 3 jam, 4 berita | 7 × 6 = ~1.260 | ❌ tidak |
| Tiap 1 jam, 2 berita | 19 × 4 = ~2.280 | ❌ tidak |

Kalau nanti butuh lebih banyak, naik ke paket Core (±Rp150 rb/bulan).

---

## Langkah 3 — Hubungkan Facebook Page

Ini bagian yang **tidak bisa dipercepat dengan kode**.

### Yang dibutuhkan
1. Anda **admin** dari sebuah Facebook Page (bukan profil pribadi)
2. Di Make, modul **Facebook Pages → Create a Post** → **Add connection** → login Facebook
3. Pilih halaman Anda saat diminta

### Kalau muncul "tidak punya izin"
Facebook mewajibkan izin `pages_manage_posts`. Untuk akun biasa, izin ini **langsung diberikan**
saat Anda menyetujui layar persetujuan — asalkan Anda memilih halaman yang Anda kelola.

Izin ini **hanya perlu App Review** kalau:
- Anda memakai aplikasi Facebook buatan sendiri, **dan**
- aplikasi itu dipakai orang lain di luar akun Anda, **atau**
- Anda meminta izin tingkat lanjut

Untuk **satu halaman milik sendiri** lewat Make, biasanya **tidak perlu App Review**.
Kalau Facebook menolak, pesan galatnya akan menyebut izin apa yang kurang — kirimkan pesan itu.

---

## Cara memastikan berhasil

Setelah skenario berjalan, jalankan sekali secara manual (**Run once**), lalu periksa:

| Yang diperiksa | Hasil yang benar |
|---|---|
| Make → modul 1 | `count` > 0, berisi `deliveryKey` 32 huruf |
| Make → modul 3 | Ada `id` postingan Facebook |
| Halaman Facebook | Postingan muncul |
| Make → modul 4 | Balasan `{ok: true, acked: 1}` |
| Hub → status antrean | Item berubah dari `pending` menjadi `delivered` |

### Arti kegagalan yang sering muncul

| Pesan | Arti |
|---|---|
| `401 Token tidak valid atau sudah dicabut` | Token salah, atau sudah dicabut. Buat token baru. |
| `403 Penarikan media sosial dibatasi` | `HUB_WRITE_TARGET` belum `production`/`both`. |
| `409 Siapkan tabel antrean media sosial dahulu` | Langkah `prepare` belum dijalankan. |
| `count: 0` | Antrean kosong — belum ada berita baru sejak putaran sebelumnya. Normal. |
| Facebook: `(#200) The user hasn't authorized the application` | Belum menyetujui izin halaman. Ulangi Add connection. |

---

## Satu hal yang harus Anda tahu

Konfirmasi kirim bersifat **"paling sedikit sekali"**, bukan "tepat sekali".

Kalau modul 4 (lapor "sudah") gagal, artikel itu **bisa muncul lagi di Facebook setelah 6 jam**.
Sebelum menyalahkan sistem, **periksa dulu halaman Facebook Anda** — mungkin sudah terkirim.

Ini disengaja: lebih baik sesekali dobel daripada berita hilang tanpa terkirim.

---

## Kalau alamat portal berubah

Blueprint memakai alamat **`https://lokal-news-fix-ujsf.vercel.app`**.

Saat pindah ke `portal-hub.online`, buka skenario di Make dan ganti alamat di **kedua** modul HTTP
(modul 1 dan modul 4). Kalau tidak diganti, Make akan menerima galat 404.

Berkas blueprint lain di folder ini (`skenario-1`, `skenario-2`, `skenario-gabungan`,
`skenario-redaktur`) **tidak diperlukan lagi** — penjadwalan sudah dijalankan GitHub Actions.
Simpan hanya untuk rujukan.
