# Panduan mengunggah Website + Hub ke branch Preview

**Baca dahulu:** ini adalah paket kode lengkap proyek terpadu *yang sudah dibuat sampai saat ini*, bukan sistem Hub terpadu yang selesai. Hub lama yang berfungsi di Arena memakai Express/SQLite dan tidak otomatis berjalan pada backend Next.js di Vercel hanya karena file disalin. Kodenya tetap tersedia di `references/legacy-hub/` untuk dilanjutkan porting; folder itu tidak berjalan otomatis pada Preview.

## A. Sebelum mengunggah

1. Gunakan **branch non-Production** pada repository/proyek Vercel yang sudah ada. Jangan merge, promote, atau mengubah branch Production. Jika belum yakin branch mana yang terhubung ke Production, periksa terlebih dahulu di pengaturan Vercel/GitHub.
2. Pastikan repository lokal bersih (`git status`) atau backup perubahan sendiri sebelum menyalin. Paket ini dimaksudkan menggantikan kode website pada branch Preview; tinjau perbedaan jika branch Anda sudah memiliki perubahan khusus.
3. **Periksa environment Preview.** Website membaca Supabase. Jika Preview menggunakan URL/key Supabase yang sama dengan Production, data nyata dapat terlihat di Preview; Preview bukan database yang otomatis terisolasi. Jangan menguji penulisan pada database bersama tanpa izin. Jika variabel publik Supabase belum ada, build/halaman website dapat gagal karena koneksi belum dikonfigurasi.
4. `/admin` memerlukan database Hub yang telah disiapkan dan variabel backend untuk operasi sebenarnya. Jika Vercel mengenali `VERCEL_ENV=preview` dan tidak ada `HUB_DATABASE_URL`, tombol **Lihat tampilan Hub** hanya membuka pratinjau statis dari file konfigurasi. Ia tidak login, tidak mengambil berita dan tidak menyimpan apa pun. Ini bukan pengganti Hub lokal. `VERCEL_ENV` termasuk variabel sistem yang perlu tersedia pada deployment [4](https://vercel.com/docs/environment-variables/system-environment-variables); bila tombol tidak terlihat, periksa apakah Preview mengenali environment tersebut dan apakah `HUB_DATABASE_URL` terisi. Jangan memaksa nilai Preview pada Production.
5. Pastikan perlindungan akses Preview sesuai kebutuhan sebelum membagikan URL. Jangan mengunggah `.env`, API key, master key, database Hub, file backup, `node_modules`, atau folder `.next`. Paket ini memang tidak menyertakannya.

## B. Sangat penting: hapus lokasi file lama pada branch

Layout dan halaman publik dipindahkan ke `src/app/(public)/`. Jika file lama di bawah tetap ada di branch, Next.js dapat mendeteksi route ganda dan build Preview gagal. `src/app/admin/actions.ts` lama juga harus tidak tersisa karena berisi aksi sinkronisasi lama.

**Daftar berdasarkan baseline lokal `e29c584`; branch lain bisa berbeda.** Sebelum menghapus, tinjau dan backup bila file memiliki perubahan yang ingin dipertahankan. Yang dimaksud adalah menghapus *file berikut di branch Preview*, bukan menghapus database atau branch Production:

```text
src/app/layout.tsx
src/app/page.tsx
src/app/berita/[slug]/page.tsx
src/app/cari/page.tsx
src/app/disclaimer/page.tsx
src/app/hiburan/page.tsx
src/app/kategori/[slug]/page.tsx
src/app/pedoman-media/page.tsx
src/app/privacy-policy/page.tsx
src/app/topik/[tag]/page.tsx
src/app/wilayah/[slug]/page.tsx
src/app/admin/actions.ts
```

Halaman yang dipindahkan sudah ada dalam paket di `src/app/(public)/...`; aksi admin lama disimpan sebagai referensi teks. Jika branch Anda punya halaman/route/layout lain pada direktori lama, periksa sendiri dan gabungkan secara hati-hati agar tidak ada route ganda atau perubahan manual yang hilang.

## C. Cara disarankan: Git atau GitHub Desktop

Gunakan Git/GitHub Desktop agar penghapusan dan penambahan dapat masuk dalam **satu commit**. Contoh di bawah dijalankan dari root repository lokal yang sudah di-clone, setelah memilih branch Preview yang benar dan memastikan `git status` bersih. Tinjau 12 file di atas dahulu. Perintah menggunakan `:(literal)` agar `[slug]` tidak dianggap pola wildcard.

```bash
git status --short
# Pastikan Anda sedang berada pada branch PREVIEW, bukan branch Production.
git branch --show-current

git rm --ignore-unmatch -- \
  ':(literal)src/app/layout.tsx' \
  ':(literal)src/app/page.tsx' \
  ':(literal)src/app/berita/[slug]/page.tsx' \
  ':(literal)src/app/cari/page.tsx' \
  ':(literal)src/app/disclaimer/page.tsx' \
  ':(literal)src/app/hiburan/page.tsx' \
  ':(literal)src/app/kategori/[slug]/page.tsx' \
  ':(literal)src/app/pedoman-media/page.tsx' \
  ':(literal)src/app/privacy-policy/page.tsx' \
  ':(literal)src/app/topik/[tag]/page.tsx' \
  ':(literal)src/app/wilayah/[slug]/page.tsx' \
  ':(literal)src/app/admin/actions.ts'
```

Selanjutnya **ekstrak ZIP** ke direktori root repository tersebut, atau salin seluruh isi ZIP ke sana. `package.json`, `package-lock.json`, `src/`, `config/`, `db/`, dan `vercel.json` harus berada langsung di root proyek, **bukan** di subfolder `website-hub-terpadu/`. Sertakan `.gitignore` (file tersembunyi). Jangan mengekstrak atau menyalin ke branch Production.

```bash
git add -A
git status --short
# Tinjau diff dan pastikan tidak ada data/rahasia yang ikut.
git diff --cached --stat
# Setelah Anda yakin branch dan diff benar:
git commit -m "Preview fondasi website dan content hub terpadu"
git push -u origin NAMA_BRANCH_PREVIEW
```

Ganti `NAMA_BRANCH_PREVIEW` dengan nama branch Anda. Bila memakai GitHub Desktop, lakukan penghapusan file dan penyalinan yang sama dalam folder repository, lalu tinjau semua perubahan sebelum commit/push. Jangan menyalin folder `.git` dari tempat lain.

Bila menggunakan browser GitHub, **ekstrak ZIP terlebih dahulu** dan perhatikan file tersembunyi; unggah isi proyek pada root branch. Pengunggahan file tidak menghapus file lama secara otomatis. GitHub mendokumentasikan batas hingga 100 file dalam satu pengunggahan browser [1](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository), sehingga perlu lebih dari satu tahap; build sementara dapat gagal sampai semua penghapusan dan penambahan selesai. Satu commit melalui Git/Desktop lebih aman.

## D. Setelah Preview selesai dibangun

- Periksa deployment bertanda **Preview**, bukan Production. Vercel biasanya membuat Preview untuk push ke branch non-Production [2](https://vercel.com/docs/deployments/preview-deployments).
- Buka website dan `/admin`. Tanpa database Hub terkonfigurasi, pilih **Lihat tampilan Hub** untuk melihat menu dan 11 situs resmi dari manifest. Jangan berharap berita lama, kolektor, AI, X/YouTube atau tombol publikasi sudah bekerja.
- `vercel.json` paket ini tidak mendaftarkan cron baru, dan route cron/push/webhook sosial lama dalam kode baru ditutup. Vercel menyatakan cron dipanggil pada Production, bukan Preview [3](https://vercel.com/docs/cron-jobs/quickstart). **Cron Production lama yang sudah ada tetap perlu ditinjau terpisah; paket Preview tidak mematikannya.** Jangan promote paket ini.
- Jaga data dan rahasia. Bila Preview menunjuk database bersama, setiap fitur tulis yang diaktifkan kemudian dapat memengaruhi data nyata; gunakan database terisolasi hanya setelah backup dan izin terpisah.

## E. Pemeriksaan lokal opsional

```bash
npm ci
npm test
npx tsc --noEmit --incremental false
```

Pada pemeriksaan terakhir 42 tes lulus. Pengujian tidak mengeksekusi migrasi Production atau kolektor live. Lihat `README-HUB-TERPADU.md`, `STATUS-HUB-TERPADU-TAHAP-AWAL.md`, dan `docs/AUDIT-SUMBER-NTB.md` untuk batasan dan pekerjaan berikutnya.
