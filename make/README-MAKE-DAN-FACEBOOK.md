# Hubungkan Make.com + Facebook Page

Panduan ini memakai endpoint yang sudah ada di Hub (r42 menambahkan aturan kesegaran):
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

Ada di **Hub → Lanjutan → "Kirim ke Facebook lewat Make"**.

Ikuti tombol dari kiri ke kanan. Tombolnya muncul **bergantian sesuai keadaan**,
jadi tidak semua terlihat sekaligus:

| Keadaan | Tombol yang muncul | Yang terjadi |
|---|---|---|
| Antrean belum disiapkan | **Siapkan antrean** | Membuat tabel antrean. Tidak menghapus data |
| Antrean sudah siap | **Buat token Make** | Token muncul **sekali** — salin saat itu |
| Antrean sudah siap | **Isi antrean sekarang** | Mengisi dari berita 6 jam terakhir, agar Make bisa diuji hari ini juga |

Di atas tombol ada baris status:

> Tertua menunggu: **0 jam** · terkirim 24 jam terakhir: **0** · umur maksimum 6 jam · kuota 16/hari · sehat

Kalau tulisan **"⚠️ ada tumpukan basi"** muncul, artinya ada berita menunggu lebih dari 6 jam —
biasanya penjadwal berhenti. Periksa GitHub Actions.

Token ini bernilai seperti kata sandi. **Jangan tempel di chat, jangan simpan di repo.**

### Kalau tombol "Siapkan antrean" belum ada

Itu berarti paket r43 belum terpasang. Jalan pintas tanpa unggah:

**Hub → Redaktur Otomatis → ⚡ Sekali Atur** → ketik `SIAPKAN SEMUA`.

Cara ini **juga** menyiapkan antrean media sosial dan menerbitkan token Make sekaligus.
Tapi ia **melakukan hal lain juga**: mengaktifkan semua sumber RSS, menandai haknya
`permission_confirmed`, dan menyalakan redaktur. Aman kalau Anda memang sudah begitu,
tapi **jangan dipakai** kalau ada sumber yang sengaja Anda turunkan ke `metadata_only`.

## Langkah 2 — Impor skenario ke Make

Berkas: **`make/skenario-facebook-hemat-kuota.blueprint.json`**

1. Make → **Scenarios** → **Import blueprint** → tempel/pilih berkas itu
2. Klik modul **nomor 3 (Facebook Pages)** → **Add connection** → login Facebook → **pilih halaman Anda**
3. Isi token: ganti `GANTI_TOKEN_SOSIAL` di **modul 1 dan modul 4**
4. **Run once** untuk menguji

### Kalau muncul "Module not found"

Itu terjadi kalau nama/versi modul tidak dikenal Make. Berkas ini sudah memakai nama yang
**terverifikasi dari blueprint asli buatan Make**:

| Modul | Nama internal | Versi |
|---|---|---|
| HTTP (ambil & lapor) | `http:ActionSendData` | 3 |
| Iterator | `builtin:BasicFeeder` | 1 |
| Facebook Pages — Create a Post | `facebook-pages:CreatePost` | 6 |

Ejaan harus **persis**: `CreatePost`, bukan `createPost`; versi **6**, bukan 1.
Kalau versi 6 ditolak di kemudian hari (Make memperbarui modul), buka modul Facebook dari
panel kanan → **Export blueprint** dari skenario lain yang berhasil, lihat angka versinya.

### Setelan penting yang tidak ikut terimpor

- **Jadwal**: 180 menit (3 jam). Ubah di *Run scenario → At regular intervals*.
- **Zona waktu organisasi**: Asia/Makassar.
- **Koneksi Facebook**: harus dipilih manual, koneksi tidak pernah ikut dalam berkas.

## Aturan pemilihan berita yang diposting

Ini bagian yang **paling penting**, karena menjawab pertanyaan
*"kalau 8 berita terbit tiap jam, antrean akan menumpuk dan yang diposting jadi berita lama"*.

Jawaban singkatnya: **antrean tidak lagi menumpuk, karena berita lama tidak pernah diposting.**

| Aturan | Nilai |
|---|---|
| Yang diambil | **paling baru dulu**, bukan yang paling lama menunggu |
| Umur maksimum | **6 jam**. Lebih dari itu → ditandai basi (`STALE_UNPOSTED`), tidak diposting |
| Kuota | **16 kiriman / 24 jam** (bergulir) |
| Kalau kuota habis | Berhenti, tidak menumpuk untuk besok |

Contoh nyata, 8 berita terbit sekaligus pada pukul 09.00:

| Make jalan | Yang diposting | Yang terjadi pada sisanya |
|---|---|---|
| 12.00 | 2 berita (umur 3 jam) | 6 menunggu |
| 15.00 | 2 berita (umur 6 jam) | 4 menunggu |
| 18.00 | **tidak ada** | 4 sisanya dibuang sebagai basi |

Jadi yang tampil di Facebook **selalu berita segar**, dan antrean **kembali bersih**,
bukan menggunung sampai berhari-hari.

### Konsekuensinya, dan ini disengaja

Mayoritas berita **tidak** akan sampai ke Facebook — hanya sekitar 16 per hari.
Itu bukan kerusakan, itu pilihan: halaman Facebook berisi **sorotan**, bukan salinan seluruh situs.
Membanjiri halaman dengan 190 postingan sehari juga akan membuat orang berhenti mengikuti.

Kalau Anda ingin lebih banyak, naikkan `cap` di URL blueprint (maksimal 48) —
tapi kuota gratis Make (1.000 operasi/bulan) hanya cukup untuk sekitar 16–20 per hari.

---

## Kenapa 2 berita per putaran

Kuota gratis Make adalah **1.000 operasi/bulan**. Satu putaran memakai:

| Langkah | Operasi |
|---|---|
| Ambil antrean (HTTP) | 1 |
| Posting Facebook | 1 per berita |
| Lapor "sudah" (HTTP) | 1 |

| Setelan | Operasi/bulan | Muat gratis? |
|---|---|---|
| Tiap 3 jam, **2** berita | 8 putaran × 4 = **~960** | ✅ pas |
| Tiap 3 jam, 4 berita | ~1.440 | ❌ tidak |
| Tiap 1 jam, 2 berita | ~2.280 | ❌ tidak |

Kalau nanti butuh lebih banyak, naik ke paket Core (±Rp150 rb/bulan).

### Yang berubah dari versi sebelumnya

Versi lama mengambil **yang paling lama menunggu dulu** dan tidak punya batas umur.
Akibatnya, begitu berita terbit lebih cepat daripada laju posting, yang diposting justru berita
berumur berhari-hari. Sekarang dibalik: **terbaru dulu + buang yang basi.**

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

## Isi data yang diterima Make

Setiap berita di antrean berbentuk seperti ini:

```json
{
  "deliveryKey": "32 huruf hex — dipakai saat lapor 'sudah'",
  "title": "Judul hasil olahan redaktur",
  "summary": "Ringkasan 2–3 kalimat",
  "articleUrl": "https://situs-anda/berita/slug  ← selalu domain portal sendiri",
  "sourceUrl": "https://sumber-asli/...",
  "image": "https://cdn-sumber/foto.jpg, atau null",
  "category": "Daerah", "region": "NTB",
  "publishedAt": "2026-11-02T16:00:00.000Z",
  "ageHours": 2
}
```

`articleUrl` **selalu** mengarah ke halaman portal Anda, bukan ke situs sumber — jadi pembaca
masuk ke portal dulu. Tautan sumber tetap dikirim di `sourceUrl` bila Anda ingin mencantumkannya.

`image` bernilai `null` bila hak sumber belum dinyatakan `permission_confirmed`.
Dalam keadaan itu Facebook tetap menampilkan gambar, diambil otomatis dari `og:image`
halaman artikel Anda. Jadi tidak perlu tindakan tambahan.


## Enam kesalahan yang mudah terjadi (dari blueprint buatan tangan)

Blueprint yang diekspor dari Make terbukti memakai aturan berikut. Ini daftar kesalahan
yang benar-benar ditemukan, lengkap dengan gejalanya:

| # | Kesalahan | Gejala yang muncul |
|---|---|---|
| 1 | URL modul 1 hanya `https://situs-anda/` (halaman depan) | Antrean tidak pernah terbaca; `items` kosong |
| 2 | Tidak ada header `Authorization` | Balasan `401 Token tidak valid` |
| 3 | **Parse response** dimatikan | Respons jadi teks mentah, tidak bisa diambil `items` |
| 4 | Array iterator ditaruh di `parameters`, bukan `mapper` | Iterator kosong → tidak ada yang diposting |
| 5 | `page_id` diisi, tapi **caption & tautan kosong** | Terbit postingan kosong tanpa teks |
| 6 | Modul terakhir membuka halaman depan, bukan `action=ack` | Berita tetap `claimed`, 6 jam kemudian jadi **basi** dan hilang |

### Aturan struktur yang wajib diikuti

- **Semua isian modul ada di `mapper`.** `parameters` hanya untuk setelan modul
  (`handleErrors`, `__IMTCONN__`).
- **Modul disambung lewat urutan** di dalam `flow`. Tidak ada kunci `next`.
- Iterator (`builtin:BasicFeeder` v1) mengambil array dari `mapper.array`.
- Modul HTTP yang menangkap JSON harus **Parse response = Yes**, lalu datanya ada di `data`.

### Satu hal untuk dicek setelah Run once

Kalau modul 2 (Iterator) melaporkan array kosong padahal modul 1 jelas menerima berita,
klik modul 1 → lihat **Output**, cari nama wadahnya. Kalau isinya ada di `body` (bukan `data`),
ubah mapping Iterator menjadi `{{1.body.items}}`. Ini perbedaan versi Make, bukan kesalahan lain.


## Kalau muncul 401 "Silakan masuk sebagai administrator"

Pesan itu **bukan** galat token — itu galat sesi login. Artinya permintaan Make tidak
dikenali sebagai permintaan otomatis.

Penyebab yang pernah terjadi (dan sudah diperbaiki di r46): rute `pull` hanya menerima
metode **POST**, padahal skenario Make memakai **GET**. Permintaan GET jatuh ke pemeriksaan
sesi admin lalu ditolak.

Yang benar sekarang: **GET maupun POST dengan header `Authorization: Bearer …`** sama-sama
dilayani tanpa sesi.

Kalau masih muncul setelah r46 terpasang, periksa berurutan:

| Cek | Yang benar |
|---|---|
| Header modul 1 | Ada `Authorization` = `Bearer <token>` (huruf `Bearer` dan satu spasi) |
| Token | Belum dicabut — lihat daftar token di panel Lanjutan |
| Pesan galat | Harus berbunyi **"Token tidak valid atau sudah dicabut"**, bukan soal login |

### Token bocor

Token Make bersifat **kata sandi**. Kalau pernah tertempel di chat, tangkapan layar,
atau dikirim ke siapa pun — **cabut sekarang** (tombol **Cabut** di panel Lanjutan),
lalu buat token baru. Token lama tidak bisa "diamankan" kembali.


## Kalau tautan yang diposting mengarah ke situs sumber, bukan portal

Tautan portal dibentuk dari alamat situs Anda. Urutan pembacaannya:

1. `HUB_PUBLIC_SITE_URL` — paling diutamakan
2. `NEXT_PUBLIC_SITE_URL` — biasanya sudah terisi di Vercel
3. `VERCEL_PROJECT_PRODUCTION_URL` — otomatis disediakan Vercel
4. `VERCEL_URL` — cadangan terakhir

Sebelum r47 kode **hanya** membaca nomor 1. Variabel itu belum diisi, sehingga sistem tidak
tahu alamat portal dan memakai tautan situs sumber. Sekarang urutan di atas membuat tautan
portal bekerja **tanpa mengisi variabel baru**.

### Cara memastikan sudah benar

Setelah r47 terpasang, jalankan satu putaran Make lalu lihat **modul 1 → Output**:

| Field | Arti |
|---|---|
| `linkTarget: "site"` | ✅ tautan ke portal sendiri |
| `linkTarget: "original"` | ⚠️ alamat portal tidak terbaca — periksa `NEXT_PUBLIC_SITE_URL` |
| `siteUrl` | alamat yang dipakai sistem |
| `items[].articleUrl` | tautan yang diposting |
| `items[].sourceUrl` | tautan situs asli (tetap dikirim, terpisah) |

### Saat pindah ke portal-hub.online

Tambahkan variabel `HUB_PUBLIC_SITE_URL = https://www.portal-hub.online` di Vercel
(Production). Variabel itu didahulukan, jadi tautan langsung berpindah tanpa mengubah kode.


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
| `data.count: 0` + `reason: QUEUE_EMPTY` | Antrean kosong — belum ada berita baru. Normal. |
| `data.count: 0` + `reason: NO_FRESH_ITEMS` | Ada antrean, tapi semuanya sudah lewat 6 jam. Normal. |
| `data.count: 0` + `reason: DAILY_CAP_REACHED` | Kuota 16/hari sudah terpakai. Normal, lanjut besok. |
| `data.linkTarget: "original"` | Tautan jatuh ke situs sumber — alamat portal tidak terbaca |
| Facebook: `(#200) The user hasn't authorized the application` | Belum menyetujui izin halaman. Ulangi Add connection. |

---

## Soal posting dobel

Dulu ada risiko: kalau lapor "sudah" gagal, artikel bisa terkirim ulang 6 jam kemudian.

**Risiko itu sekarang hilang.** Karena umur maksimum 6 jam sama dengan masa tenggang klaim,
item yang terlambat dilaporkan sudah dianggap basi dan **tidak diposting ulang**.

Yang dikorbankan: kalau posting gagal total **dan** laporannya juga gagal, berita itu tidak dicoba lagi.
Untuk berita, itu pertukaran yang wajar — berita 6 jam terlambat tidak layak diposting.

---

## Kalau alamat portal berubah

Blueprint memakai alamat **`https://lokal-news-fix-ujsf.vercel.app`**.

Saat pindah ke `portal-hub.online`, buka skenario di Make dan ganti alamat di **kedua** modul HTTP
(modul 1 dan modul 4). Kalau tidak diganti, Make akan menerima galat 404.

Berkas blueprint lama (`skenario-1`, `skenario-2`, `skenario-gabungan`, `skenario-redaktur`)
sudah **dihapus** — selain tidak diperlukan lagi (penjadwalan dijalankan GitHub Actions),
keempatnya memakai format yang salah sehingga gagal diimpor.
