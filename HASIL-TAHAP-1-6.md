# Hasil kerja: tahap 1–6 + B1, B3, B4

Dikerjakan 1 November 2026. **259/259 tes PASS**, `tsc` bersih, `next build` sukses, penjaga ISR lulus.

---

## Bukti utama: ISR akhirnya menyala

Sebelum (build lama):

```
├ ƒ /berita/[slug]        ← ƒ = dirender ulang SETIAP kunjungan
├ ƒ /kategori/[slug]
├ ƒ /topik/[tag]
└ ƒ /wilayah/[slug]
```

Sesudah:

```
┌ ○ /                    2m      1y
├ ● /berita/[slug]       898 B   107 kB
├ ● /kategori/[slug]     2.05 kB 108 kB   2m  1y
├ ● /topik/[tag]         172 B   106 kB
└ ● /wilayah/[slug]      172 B   106 kB
```

`●` = static dengan ISR. Penjaga baru juga sudah diuji **dua arah**:

```
$ npm run check:isr
✅ ISR aktif pada 6 route publik: /, /berita/[slug], /hiburan, /kategori/[slug], /topik/[tag], /wilayah/[slug]

$ node scripts/check-isr.mjs <log-lama-yang-masih-ƒ>
❌ ISR MATI pada halaman publik berikut:
   ƒ /berita/[slug]
   (exit 1)
```

---

## Tahap 1 — Cache ber-tag, bukan `force-cache`

Review menyarankan `fetchCache = 'force-cache'`. Itu **tidak saya pakai**: dengan cache buta,
berita baru dari Hub bisa tertahan sampai satu jam. Yang dipakai:

| Bagian | Cara |
|---|---|
| `src/lib/queries.ts` | 9 fungsi dibungkus `unstable_cache` dengan tag |
| Tag | `hub-articles` · `hub-trends` · `hub-regions` |
| Masa simpan | daftar 300 dtk · detail artikel 900 dtk · tren 120 dtk |
| Pemberitahuan | `/api/revalidate` memanggil `revalidateTag` |
| Pemanggil | `supabaseDeliver()` (Hub) memanggilnya **setelah** artikel berhasil dikirim |

Hasil: crawl Googlebot dilayani cache, **tetapi berita baru tetap tampil seketika**.

`searchArticles` **sengaja tidak di-cache** — hasil pencarian tidak boleh basi.

---

## Tahap 2 — `generateStaticParams` di empat route

| Route | Sumber daftar awal |
|---|---|
| `/berita/[slug]` | 100 slug terbaru · `dynamicParams = true` |
| `/kategori/[slug]` | seluruh kategori dari konfigurasi · `dynamicParams = false` |
| `/wilayah/[slug]` | wilayah aktif dari database · `dynamicParams = true` |
| `/topik/[tag]` | tag yang muncul ≥3 artikel · `dynamicParams = true` |

Review hanya menyebut dua route; **topik dan wilayah juga `ƒ`** dan itu ikut diperbaiki.

---

## Tahap 3 — Penjaga CI

- `scripts/check-isr.mjs` — membaca tabel build, gagal bila route publik bertanda `ƒ`.
- `.github/workflows/ci.yml` — `tsc` → tes → build → penjaga ISR pada setiap push/PR.
- `npm run verify` untuk menjalankan seluruh rangkaian di komputer sendiri.

Sebelum ini 259 tes **tidak pernah berjalan otomatis**. Tes yang tidak dijalankan tidak menjaga apa pun.

---

## Tahap 4 — `NEXT_PUBLIC_SITE_URL` tidak boleh localhost

`src/config/site.ts` kini membatalkan build bila di Vercel/produksi alamatnya masih `localhost`.
Tanpa ini, canonical, OG URL, dan sitemap menunjuk localhost — gagal senyap.

---

## Tahap 5 — Sandbox iklan diperbaiki

```diff
- sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
+ sandbox="allow-scripts allow-popups"
```

`allow-scripts` + `allow-same-origin` membuat iframe dapat **menghapus** atribut sandbox.
`allow-popups-to-escape-sandbox` membiarkan popup iklan keluar tanpa sandbox. Keduanya dibuang.

---

## Tahap 6 — Halaman publik tidak lagi menyebut `/admin`

| Berkas | Dulu | Sekarang |
|---|---|---|
| `(public)/page.tsx` | "Belum ada berita. Tambahkan sumber di /admin lalu klik Sync sekarang." | daftar wilayah + kategori yang bisa diklik |
| `(public)/hiburan/page.tsx` | "Tambahkan sumber bagian Hiburan di /admin." | "Coba kembali nanti…" + tautan beranda |

---

## B1 — Judul berupa nama situs ditolak

`src/lib/quality.ts` → `isSiteNameTitle()`. Dipakai di `content-hub/mapping.ts`:
judul buruk → coba `original_title` → bila keduanya buruk, **artikel dibuang**, bukan terbit tanpa judul.

Uji 8 kasus, semuanya benar:

| Judul | Hasil |
|---|---|
| `Kementerian Komunikasi dan Digital - Komdigi` | ditolak ✔ |
| `Portal Resmi Pemerintah Kota Bima` | ditolak ✔ |
| `RSUD SONDOSIA - bimakab.go.id` | ditolak ✔ |
| `Bupati Dompu dukung BPR NTB …` | diterima ✔ |
| `Mentan Amran: Indonesia kuat saat 33 negara …` | diterima ✔ |
| `Anak Muda Jembrana Ditantang Jangan Jadi Penonton` | diterima ✔ |
| `Pelatihan Mataram` | diterima ✔ |

Catatan jujur: percobaan pertama saya **salah** — aturan "huruf kapital" saya menolak
`Pelatihan Mataram`, dan kata `Resmi` saya anggap kata kerja sehingga `Portal Resmi …` lolos.
Keduanya ketahuan oleh tes dan sudah diperbaiki.

---

## B3 — "Lowongan terbaru" hanya untuk lowongan sungguhan

`isJobPosting()` mewajibkan niat pengumuman: *lowongan · lerekrutan · pendaftaran CPNS/PPPK ·
formasi · job fair · dibutuhkan N orang*.

| Teks | Dulu | Sekarang |
|---|---|---|
| `Bupati Dompu dukung BPR NTB perluas layanan PPPK dan UMKM` | tampil sebagai "Lowongan terbaru" | **tidak** |
| `Pemkab Bima buka pendaftaran PPPK 2026` | lowongan | lowongan ✔ |
| `Lowongan Kerja PT Wanhe Garment …` | lowongan | lowongan ✔ |

Dua lapis: aturan kategori (`refineCategory`) **dan** kartu beranda (`jobs.find(isJobPosting)`).

---

## B4 — Halaman topik tipis tidak lagi terbit

| Perubahan | Berkas |
|---|---|
| Kata umum ditolak (`tahun`, `orang`, `jadi`, `2026`, `pemkab`…) | `quality.ts` → `isMeaningfulTag()` |
| Tag sampah tidak masuk saat pemetaan | `content-hub/mapping.ts` |
| Tag sampah tidak masuk sitemap | `sitemap.ts` |
| `/topik/[tag]` **404** bila <3 artikel (dulu hanya `noindex`, tetap 200) | `topik/[tag]/page.tsx` |

Singkatan 3 huruf (`KPK`, `DPR`, `BPBD`) tetap diterima — awalnya ikut tertolak, sudah dibetulkan.

---

## Yang perlu Anda isi di Vercel (2 nilai, sekali)

| Variabel | Lingkungan | Nilai |
|---|---|---|
| `HUB_REVALIDATE_SECRET` | Production **dan** Preview | teks acak ≥16 karakter (boleh dari `openssl rand -hex 32`) |
| `HUB_REVALIDATE_URL` | Production **dan** Preview | `https://lokal-news-fix-ujsf.vercel.app/api/revalidate` |

Tanpa keduanya, semuanya tetap jalan — hanya berita baru menunggu ≤5 menit, bukan seketika.

---

## Yang belum dikerjakan (dan kenapa)

| Item | Alasan |
|---|---|
| B2 (lowongan luar wilayah) | **atas permintaan Anda: dibiarkan** |
| `next/image`, CSP/HSTS, satukan dua pipeline | di luar tahap 1–6; besar, bukan penghambat |
| `ads.txt`, `/rss.xml`, `/redaksi` | bagian AdSense; menunggu keputusan Anda |
| `og:image` kartu teks `/api/og` | bukan bagian B1–B5, tapi masih terbuka |


---

## Perubahan tampilan (r30–r32)

| # | Permintaan | Hasil |
|---|---|---|
| 1 | Logo sendiri, ganti tulisan "Kabar Lokal" | Logo dipasang di `public/logo.png`; tulisan otomatis disembunyikan agar tidak dobel |
| 2 | Ruang kosong di bawah carousel | Diisi Pemda → Hiburan → Olahraga, satu tiap kategori, tidak pernah kosong |
| 3 | Media sosial di footer | Enam tombol, **diisi dari panel Hub**, bukan env |
| 4 | Hapus kalimat "Ringkasan otomatis dari teks sumber…" | Dihapus; tinggal "Sumber: …" |
| 5 | Hapus "1 dari 6" di carousel | Dihapus; tombol jeda tetap ada |
| 6 | Tombol "Muat berita lainnya" kurang menonjol | Hijau penuh, lebih besar, ada cincin fokus |

## Nama & domain baru

`portal-hub` — domain rencana `https://www.portal-hub.online`.

Satu nilai mengubah seluruh situs: judul tab, judul Google, copyright, data terstruktur, dan
nama penerbit di JSON-LD.

**Yang harus disetel saat pindah domain:**

```
NEXT_PUBLIC_SITE_URL=https://www.portal-hub.online
```

Bila lupa, build **dibatalkan** dengan pesan yang menyebut domain yang benar — bukan terbit
dengan canonical localhost. Sudah diuji:

```
OK — build ditolak: NEXT_PUBLIC_SITE_URL wajib diisi di produksi.
Setel ke https://www.portal-hub.online (jangan biarkan localhost).
```

**Pilih satu bentuk alamat** (pakai `www` atau tanpa `www`, jangan dua-duanya): canonical,
sitemap, dan `og:url` mengikuti satu bentuk. Bentuk yang tidak dipakai diarahkan (301) ke yang dipakai.

## Media sosial kini di database

Tabel `hub_site_settings` dibuat otomatis saat pertama dipakai — **tidak perlu SQL manual**.
Diisi lewat menu **Pengaturan Situs** di panel Hub. Diuji ujung-ke-ujung: enam tautan dibaca
dari database dan muncul di footer tanpa satu pun env media sosial.


---

## Fokus SEO (bulan 1) — yang sudah dikerjakan

Hasil audit situs produksi 1 Nov 2026, tiga celah ditemukan dan diperbaiki:

| Celah | Bukti sebelum | Sekarang |
|---|---|---|
| Sitemap berita (Google News) | `/sitemap-news.xml` → **HTTP 404** | Ada, isi 48 jam terakhir, maks 1.000 URL |
| RSS | `/rss.xml` → **HTTP 404** | Ada, 50 berita terbaru, sah secara XML |
| Logo penerbit di data terstruktur | `"logo"` tidak ada di JSON-LD NewsArticle | Ada, memakai `/logo.png` |

Tambahan: `robots.txt` kini menyebut dua sitemap; halaman menyertakan tautan RSS sehingga
pembaca dan agregator bisa menemukannya.

### Uji yang dilakukan

```
/rss.xml           → XML SAH (dibaca parser)
/sitemap-news.xml  → XML SAH
/robots.txt        → dua baris Sitemap
```

### Yang MASIH menjadi penghambat peringkat

1. **Umur domain.** Situs baru butuh waktu; tidak ada cara mempercepat selain isi yang konsisten.
2. **Berita dari sumber lain.** Google lebih menghargai liputan sendiri. Portal ini meringkas;
   itu batas nyata, bukan sesuatu yang bisa ditutup dengan kode.
3. **Gambar.** Sekarang memakai gambar sumber dengan `referrerPolicy="no-referrer"`; sebagian
   sumber memblokir, sehingga gambar bisa kosong dan pratinjau Discover ditolak.
4. **Halaman tipis.** Sudah dibatasi (topik <3 artikel = 404), tapi jumlah artikel per wilayah
   masih kecil.
