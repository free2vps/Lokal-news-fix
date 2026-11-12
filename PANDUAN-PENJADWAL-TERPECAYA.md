# Penjadwal yang tidak bisa "hilang" diam-diam

## Temuan dari bukti Anda

Tangkapan layar GitHub Actions Anda hari ini:

| Run | Waktu | Jenis |
|---|---|---|
| #4 | 08:09 | **Scheduled** ✅ |
| #5 | 13:36 | Manual |
| #6 | 15:06 | **Scheduled** ✅ |
| #7 | 19:20 | Manual |

Seharusnya **19 putaran terjadwal** (05:00–23:59 WITA tiap jam). Yang benar-benar dijadwalkan
GitHub: **2 kali**. Semua **Success**, durasi ~1m50s, di cabang `main`, berkas `hub-tick.yml`.

Artinya: **kode Anda tidak bersalah.** GitHub hanya menjalankan jadwalnya 2 kali dari 19.

## Ini masalah resmi GitHub, bukan setelan Anda

Dokumentasi GitHub menyebut jadwal `schedule` bersifat **best-effort**:

> "The schedule event can be delayed during periods of high loads... High load times include
> the start of every hour. If the load is sufficiently high enough, some queued jobs may be
> **dropped**."

Yang penting: run yang dibuang **tidak meninggalkan jejak apa pun** — tidak ada ❌, tidak ada
log, tidak ada email. Persis yang Anda alami.

Sejak akhir Agustus 2026 banyak pemilik repo melaporkan hal sama, dengan angka mirip:
cron per jam hanya jalan **0–3 kali sehari**. Salah satu laporan: repo privat dengan
`17 * * * *` hanya dapat **3 run dalam 24 jam**.

Karena itu: **jangan bergantung pada jadwal GitHub untuk hal yang harus jalan tiap jam.**

---

## Dua perbaikan, dari yang termurah

### Perbaikan 1 — hindari menit 0 (gratis, sudah saya kerjakan)

Awal jam adalah periode paling padat, dan di situlah run paling sering dibuang.

```yaml
# sebelum
- cron: '0 0-15,21-23 * * *'
# sesudah
- cron: '17 0-15,21-23 * * *'
```

Ini menurunkan peluang dibuang, **tetapi tidak menghilangkannya**. Pada kasus yang sedang
berlangsung sekarang, sebagian repo melaporkan menit ganjil pun terkena.

Tetap lakukan — tanpa biaya, dan tidak ada ruginya.

### Perbaikan 2 — denyut dari luar GitHub (ini yang benar-benar memperbaiki)

Tambahkan satu layanan penjadwal gratis yang memanggil Hub langsung, **tanpa lewat GitHub**.
Kuota GitHub tidak terpakai, dan jadwalnya jauh lebih tepat.

Layanan yang layak: **cron-job.org** (gratis, per menit) atau **cron-jobpro.com**.
Berikut langkah untuk cron-job.org.

#### Yang dipanggil

```
POST https://www.portal-hub.online/api/hub/auto-editor?action=run
Header: Authorization: Bearer <TOKEN_OTOMASI>
Header: Accept: application/json
```

`<TOKEN_OTOMASI>` adalah token otomasi dari **Hub → Lanjutan → Penjadwal otomatis**.
Nilainya sama dengan yang tersimpan sebagai `HUB_AUTOMATION_TOKEN` di GitHub Secrets.

#### Langkah di cron-job.org

1. Daftar gratis di `cron-job.org`
2. **Create cronjob**
3. **Title:** `portal-hub tick`
4. **URL:** `https://www.portal-hub.online/api/hub/auto-editor?action=run`
5. **Schedule:** every 1 hour → pilih menit **17** (sama dengan cron GitHub)
6. Tab **Advanced**:
   - **Request method:** `POST`
   - **Headers:**
     - `Authorization` = `Bearer <TOKEN_OTOMASI>`
     - `Accept` = `application/json`
   - **Timeout:** 300 detik
7. **Save**
8. Klik **Test run** → harus muncul **HTTP 200** dan JSON berisi `"status"`

#### Kenapa tetap pertahankan jadwal GitHub

Biarkan keduanya hidup. Kalau satu terlewat, yang lain menutup. Keduanya memanggil endpoint
yang sama, dan endpoint itu **aman dipanggil berkali-kali** — putaran kedua dalam waktu dekat
dijawab `409` (cooldown) dan tidak menerbitkan ganda.

---

## Yang perlu Anda tahu sebelum memasang

### Token akan tersimpan di satu tempat lagi

Layanan penjadwal luar harus menyimpan token otomasi Anda. Token itu bisa **memerintahkan
satu putaran**, bukan membaca atau mengubah data lain. Kalau nanti bocor:

1. buka **Hub → Lanjutan → Penjadwal otomatis**
2. tekan **Cabut** pada token lama
3. buat token baru
4. perbarui di GitHub Secrets **dan** di cron-job.org

### Jangan pakai token media sosial

Token untuk Make (`ISSUE SOCIAL TOKEN`) **berbeda** dan hanya bisa menarik/mengakui antrean
Facebook. Jangan tertukar.

---

## Cara memastikan penjadwal benar-benar hidup

### Dari GitHub

Tab **Actions** → **Hub tick per jam**. Dalam 24 jam seharusnya ada **lebih banyak** baris
bertanda *Scheduled* daripada sebelumnya.

### Dari Hub (paling cepat)

**Hub → Lanjutan → Penjadwal otomatis**, ada baris:

> **Putaran terjadwal terakhir:** 2 Nov 2026, 20.17 WITA · ok

Periksa dua kali dengan jeda satu jam. Kalau waktunya bertambah, penjadwal hidup.

### Dari portal

`sitemap-news.xml` memuat `news:publication_date`. Kelompokkan per jam:

```
curl -s https://www.portal-hub.online/sitemap-news.xml \
  | grep -o '<news:publication_date>[^<]*' | sed 's/.*T//' | cut -c1-2 | sort | uniq -c
```

Kalau banyak jam kosong padahal stok berita sumber ada, penjadwal sedang melewatkan putaran.

---

## Berapa lama seharusnya jeda antarputaran?

| Kondisi | Arti |
|---|---|
| Jeda ≤ 1,5 jam | Normal (GitHub suka terlambat 5–30 menit) |
| Jeda 2–5 jam | Sering dilewatkan — pasang penjadwal luar |
| Jeda > 6 jam | Penjadwal praktis mati |

Batas terbit per putaran: **8 artikel**, batas harian **40**. Dengan penjadwal yang hanya
jalan 2–3 kali sehari, maksimal ~24 artikel/hari — itulah sebabnya berita terasa berhenti.

---

## Kalau cron-job.org menjawab "Failed (timeout)"

Ini bukan tanda sistem Anda rusak. **cron-job.org versi gratis membatasi 30 detik.**
Putaran redaktur otomatis Anda butuh lebih lama (di GitHub tercatat ~1 menit 50 detik),
jadi cron-job.org menyerah lebih dulu.

### Hal pertama yang harus diperiksa

Timeout di sisi pemanggil **tidak selalu berarti pekerjaannya gagal**. Permintaan sudah
sampai ke server; cron-job.org hanya berhenti menunggu jawabannya.

Periksa: **Hub → Lanjutan → Penjadwal otomatis** → baris *Putaran terjadwal terakhir*.

| Yang terlihat | Artinya |
|---|---|
| Waktunya **baru**, sesuai jadwal | Putaran **berhasil**, timeout hanya soal siapa yang menunggu |
| Waktu **tidak berubah** | Putaran benar-benar tidak selesai |

⚠️ **Jangan dibiarkan.** cron-job.org otomatis **mematikan job setelah 25 kegagalan
berturut-turut**. Kalau dibiarkan, dalam sehari job-nya mati sendiri.

### Jalan keluar A — naikkan batas waktu (paling mudah, tapi berbayar)

Batas 30 detik hanya berlaku untuk akun gratis. Dengan **Sustaining Membership**
(donasi ±€5–20/bulan) batasnya naik menjadi **5 menit**.

Cara: di cron-job.org → **Settings → Sustaining membership**. Lalu di job Anda →
**Advanced → Timeout** → isi `300`.

Kalau Anda tidak mau berdonasi, lewati ke jalan keluar B.

### Jalan keluar B — jangan suruh cron-job.org menunggu (disarankan)

Alih-alih cron-job.org memanggil Hub dan menunggu 90 detik, suruh ia **menyuruh GitHub**
menjalankan workflow. GitHub API menjawab **seketika** (kurang dari 1 detik) dengan
`204 No Content`, lalu GitHub sendiri yang menjalankan putaran panjangnya — lengkap dengan
log dan percobaan ulang.

```
cron-job.org  (cepat, 0,3 detik)
      ↓ POST ke GitHub API
GitHub Actions (menjalankan putaran, ~2 menit)
      ↓ POST
Hub /api/hub/auto-editor?action=run
```

Ini memanfaatkan hal yang **sudah terbukti bekerja**: run GitHub Anda selalu
**Success**, hanya jadwalnya yang dilewatkan GitHub. Kita tidak memakai penjadwal GitHub,
hanya **runner**-nya.

#### Yang dibutuhkan

**1. Token GitHub (fine-grained)**

- Buka GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
- **Generate new token**
- **Repository access:** Only select repositories → pilih repo proyek Anda
- **Permissions → Repository permissions → Actions:** `Read and write`
- Simpan token — hanya tampil sekali

**2. Atur job di cron-job.org**

| Isian | Nilai |
|---|---|
| URL | `https://api.github.com/repos/<akun>/<repo>/actions/workflows/hub-tick.yml/dispatches` |
| Method | `POST` |
| Schedule | tiap 1 jam, menit **17** |
| Timeout | `30` (cukup, jawabannya seketika) |

**Headers:**

| Nama | Nilai |
|---|---|
| `Authorization` | `Bearer <TOKEN_GITHUB>` |
| `Accept` | `application/vnd.github+json` |
| `Content-Type` | `application/json` |

**Body (raw JSON):**

```json
{"ref":"main"}
```

Ganti `<akun>` dan `<repo>` dengan milik Anda. Nama berkas `hub-tick.yml` harus persis.

**3. Uji**

Tekan **Test run** di cron-job.org. Harus muncul **HTTP 204**. Lalu buka GitHub →
**Actions** → akan ada run baru bertanda *workflow_dispatch* dalam beberapa detik.

#### Kenapa ini lebih baik daripada memanggil Hub langsung

| | Panggil Hub langsung | Lewat GitHub |
|---|---|---|
| Batas tunggu | 30 detik (gratis) | tidak relevan, jawaban seketika |
| Ada log kalau gagal | tidak | **ya, lengkap** |
| Percobaan ulang otomatis | tidak | **ya** (curl --retry 3) |
| Token yang disimpan | token Hub | token GitHub |

Token GitHub yang dipakai **hanya bisa memicu workflow** di satu repo. Kalau nanti bocor:
hapus token di GitHub, buat baru, perbarui di cron-job.org.

### Jalan keluar C — percepat putarannya (kalau ingin tetap gratis dan langsung)

Putaran lambat karena menarik 22 sumber RSS satu per satu. Yang bisa dikecilkan:

- Kurangi jumlah sumber aktif di **RSS Manager** (matikan yang jarang menghasilkan berita)
- Turunkan batas `maxPerRun` di panel Redaktur Otomatis

Ini **mengurangi hasil**, jadi hanya pilih bila Anda memang ingin stok berita lebih sedikit.

### Rekomendasi saya

**Jalan keluar B.** Gratis, ada log, ada percobaan ulang, dan tidak bergantung pada
penjadwal GitHub yang sedang bermasalah.
