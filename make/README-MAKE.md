# Make.com — Redaktur Otomatis 3 jam (Tahap 10)

Ini skenario **utama** sekarang. Satu pemicu menjalankan seluruh rantai:

| # | Modul | Panggilan |
|---|---|---|
| 1 | HTTP | `POST {HUB}/api/hub/auto-editor?action=run` — Bearer **token otomasi** |
| 2 | HTTP | `GET {HUB}/api/hub/social?action=pull&max=4` — Bearer **token sosial** |
| 3 | Iterator | `{{2.body.items}}` |
| 4 | Facebook Pages → Create a Post | `message` = judul + ringkasan + tautan |
| 5 | HTTP | `POST {HUB}/api/hub/social?action=ack` — `[{"deliveryKey":"{{3.deliveryKey}}","ok":true}]` |

Berkas blueprint: `skenario-redaktur-3jam-05-24.blueprint.json`.

Modul 1 sudah mencakup: tarik semua sumber RSS aktif → profil → nilai editorial → ringkasan (ekstraktif semua, AI untuk prioritas) → pilih sesuai kriteria → **terbit otomatis** ke database situs → isi antrean media sosial. Jadi Anda tidak perlu memanggil endpoint lain.

## Jadwal 05:00–23:59 (bukan 24 jam)
1. **Run scenario → At regular intervals → 3 hours**
2. **Advanced scheduling → Time from `05:00` / Time to `23:59`**, semua hari
3. **Organization time zone = Asia/Makassar**

Hasil: 7 putaran/hari (05, 08, 11, 14, 17, 20, 23). Setelan jendela jam **tidak ikut** saat impor blueprint — isi manual sekali.

## Respons modul 1 yang perlu Anda perhatikan
```json
{ "status": "ok|partial|disabled",
  "pulled": 41, "candidates": 12, "selected": 8, "published": 8,
  "reasons": {"value_tier_below_minimum": 15, "date_outside_window": 6, ...},
  "steps": [{"step":"pull","ok":true,"detail":"..."}, ...] }
```
- `status: disabled` → saklar redaktur masih mati di Hub. Nyalakan di panel.
- `published: 0` + `reasons.rights_not_permission_confirmed` → belum ada sumber berhak terkonfirmasi.
- `published: 0` + `selected: 0` + `reasons.value_tier_below_minimum` → kelas minimum terlalu tinggi untuk stok berita saat ini.

## Bila ingin dipisah
Skenario lama (`skenario-gabungan-3jam-05-24.blueprint.json`, dua skenario Tahap 9) tetap berfungsi untuk pemisahan: otomasi dulu, posting kemudian. Untuk pemakaian harian, pakai yang satu ini.

## Biaya
≤10 ops/putaran × 7 putaran × 30 hari ≈ **≤2.100 ops/bulan** → paket Core. Free (1.000 ops) tidak cukup.

## Galat posting Facebook
Item yang gagal tetap tercatat dan dicoba lagi setelah lease 6 jam (maks 5 percobaan). Tambahkan error handler **Resume** pada modul Facebook + ack `ok:false` bila ingin langsung dicoba pada putaran berikutnya.
