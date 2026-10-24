# Distribusi otomatis: Make.com / n8n

## Alur
Cron `/api/cron` → berita baru tersimpan → `distributeBatch()` mengirim maksimal `DISTRIBUTE_PER_RUN` berita
(terlama dulu) ke `AUTOMATION_WEBHOOK_URL` → Make/n8n memposting ke Facebook, Telegram, WhatsApp.
Kolom `articles.distributed_at` mencegah kirim ganda; jika webhook gagal, berita dicoba lagi pada putaran berikutnya (24 jam).
Alternatif instan: Supabase Dashboard → Database → Webhooks → Create (tabel `articles`, event INSERT, POST ke
`https://DOMAIN/api/webhooks/social-share`, header `x-webhook-secret: <WEBHOOK_SECRET>`), lalu set `DISTRIBUTE_PER_RUN=0`.

## Payload (POST JSON ke Make/n8n)
```json
{
  "event": "article.published", "id": 123,
  "title": "…", "url": "https://domain/berita/slug", "category": "Info Pemda", "region": "Sumbawa Barat",
  "source_name": "ANTARA", "published_at": "2026-10-24T05:00:00Z",
  "image_url": "https://…jpg", "og_image_url": "https://domain/api/og?…",
  "summary_short": "Dua kalimat ringkas.", "hook": "Kalimat pembuka sosial.",
  "hashtags": ["#SumbawaBarat", "#apbd"],
  "caption": { "facebook": "…", "telegram_html": "<b>…</b> …", "whatsapp": "*…* …" }
}
```
Header: `x-webhook-secret: <AUTOMATION_SECRET>`. Tolak permintaan tanpa header itu (filter di Make / IF node di n8n).

## Make.com
1. Scenario baru → **Webhooks > Custom webhook** (centang "Get request headers"), salin URL ke `AUTOMATION_WEBHOOK_URL`; kirim satu contoh payload agar struktur terbaca.
2. **Filter** setelah webhook: header `x-webhook-secret` sama dengan `AUTOMATION_SECRET`.
3. **Facebook Pages > Create a Post**: Page = halaman Anda, Message = `caption.facebook`, Link = `url`. (Tautan membuat Facebook mengambil kartu dari OG tag situs.)
4. **Telegram Bot > Send a Photo** (atau Send a Message bila `image_url` kosong): Chat ID = `@namachannel`, Photo URL = `image_url` (cadangan: `og_image_url`), Caption = `caption.telegram_html`, Parse mode = HTML.
5. WhatsApp: lihat catatan di bawah.
6. Atur **Scheduling** scenario ke "Immediately" dan aktifkan; tambahkan error handler (Resume/Ignore) agar satu kegagalan tidak menghentikan yang lain.

## n8n
1. **Webhook** node (POST, Authentication: Header Auth `x-webhook-secret`) → salin Production URL.
2. **Facebook Graph API** node (atau HTTP Request ke `POST /{page-id}/feed` dengan `message`, `link`, token Page).
3. **Telegram** node: operation Send Photo (atau Send Message), Chat ID `@namachannel`, Parse Mode HTML.
4. **Split In Batches / Wait** (10–15 menit) bila Anda memakai pengiriman instan agar tidak membanjiri kanal.

## Telegram
@BotFather → /newbot → simpan token. Tambahkan bot sebagai **Administrator** kanal dengan izin "Post messages".

## WhatsApp Channel (penting)
API resmi WhatsApp Business (Cloud API) **tidak** bisa memposting ke Saluran (Channels). Pilihan:
- Layanan pihak ketiga tidak resmi (mis. gateway berbasis sesi akun) yang punya endpoint kirim ke Saluran. Berjalan lewat nomor WhatsApp yang ditautkan; ada risiko pelanggaran ketentuan dan pemblokiran nomor.
- Cara aman: Make/n8n mengirim caption `caption.whatsapp` ke Telegram/email pribadi Anda lalu Anda teruskan manual ke Saluran (semi-otomatis).
- Cloud API resmi hanya untuk pesan ke kontak yang opt-in (berbayar, butuh template untuk pesan proaktif), bukan Saluran.
