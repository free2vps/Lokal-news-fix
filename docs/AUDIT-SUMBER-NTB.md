# Audit awal 11 sumber pemerintah NTB

Pemeriksaan awal: 27 Oktober 2026 WITA, dari lingkungan kerja ini. Ini adalah hasil sesaat, bukan jaminan kondisi situs dari lokasi lain, kesegaran artikel, atau izin lisensi. Rincian yang dihasilkan skrip: `official-ntb-source-check.json`. Pemeriksaan tidak membuka halaman artikel, tidak mengubah database produksi, dan tidak mengaktifkan kolektor.

- **Lombok Timur:** `robots.txt` tersedia dan halaman daftar yang diminta merespons 200. Pemeriksaan tambahan terbatas pada halaman daftar yang sama menemukan 30 judul/tautan berformat `/baca-berita-{id}-...html` dalam konten yang diekstrak. Tanggal publikasi tidak terlihat pada daftar hasil ekstraksi, sehingga tidak dapat dipastikan artikel mana yang terkini berdasarkan tanggal. Parser offline khusus telah dibuat; ia hanya menghasilkan judul dan tautan serta membiarkan tanggal `null`. Parser belum dihubungkan ke jaringan atau diaktifkan. Pemeriksaan pertama memakai detektor URL generik, sehingga angka 0 pada JSON pertama adalah keterbatasan detektor, bukan berarti daftar kosong.
- **NTB dan Lombok Barat:** rantai sertifikat HTTPS tidak dapat diverifikasi di lingkungan ini; verifikasi TLS tidak dinonaktifkan.
- **Lombok Utara dan Sumbawa Barat:** pemeriksaan `robots.txt` melewati batas waktu; aturan akses belum dapat dipastikan.
- **Lombok Tengah:** `robots.txt` tidak ditemukan (404), tetapi halaman yang diberikan merespons 403. Tidak ada upaya melewati pembatasan.
- **Sumbawa:** `robots.txt` tersedia, tetapi halaman daftar merespons 403/perlindungan otomatis. Tidak dilewati.
- **Dompu, Kabupaten Bima, Kota Mataram, Kota Bima:** `robots.txt` merespons 403. Halaman daftar tidak diminta oleh skrip audit karena aturan akses belum dapat dipastikan.

Tidak ada RSS yang berhasil diverifikasi dalam pemeriksaan ini. Semua sumber pada inisialisasi lokal berstatus nonaktif, jenis `government_website`, format `unverified`, dan hak `unknown`; URL HTML bukan RSS. Agar pengumpulan dilakukan di kemudian hari, cek ulang aturan, konektivitas dan ketentuan sumber dari lingkungan kolektor yang dipilih; pastikan ada izin yang sesuai dan jangan menyalin artikel penuh tanpa hak.
