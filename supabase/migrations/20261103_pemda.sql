-- Agregator 11 Pemda NTB — tabel sumber kebenaran halaman publik.
-- Dijalankan HANYA setelah pemilik menyetujui. Berkas ini tidak dijalankan otomatis.
create table if not exists public.pemda (
  id           text primary key,
  nama         text not null,
  nama_pendek  text not null,
  jenis        text not null check (jenis in ('provinsi','kabupaten','kota')),
  situs        text,
  status_akses text not null default 'belum' check (status_akses in ('bisa','diblokir','mati','belum')),
  email_humas  text,
  email_ppid   text,
  izin_status  text not null default 'belum' check (izin_status in ('belum','diminta','disetujui','ditolak')),
  izin_tanggal date,
  izin_catatan text,
  created_at   timestamptz not null default now()
);

create table if not exists public.artikel_pemda (
  artikel_id bigint not null references public.articles(id) on delete cascade,
  pemda_id   text   not null references public.pemda(id) on delete cascade,
  peran      text   not null default 'subjek' check (peran in ('subjek','disebut')),
  primary key (artikel_id, pemda_id)
);

alter table public.articles add column if not exists jenis_sumber text default 'media'
  check (jenis_sumber in ('rilis','media','sendiri'));

create index if not exists artikel_pemda_pemda_idx on public.artikel_pemda(pemda_id);
create index if not exists pemda_status_idx on public.pemda(status_akses);

-- 11 pemda. status_akses diukur 3 Nov 2026 dari server (bukan tebakan):
--   bisa    : halaman daftar berhasil dibaca
--   diblokir: Cloudflare / reCAPTCHA / ASN diblokir (galat 1005)
--   mati    : tidak menjawab sama sekali
insert into public.pemda (id, nama, nama_pendek, jenis, situs, status_akses) values
  ('ntb-provinsi',   'Pemerintah Provinsi Nusa Tenggara Barat', 'Provinsi NTB',  'provinsi',  'https://ntbprov.go.id/', 'bisa'),
  ('lombok-barat',   'Pemerintah Kabupaten Lombok Barat',       'Lombok Barat',  'kabupaten', 'https://portal.lombokbaratkab.go.id/jelajah/artikel/', 'bisa'),
  ('lombok-tengah',  'Pemerintah Kabupaten Lombok Tengah',      'Lombok Tengah', 'kabupaten', 'https://www.lomboktengahkab.go.id/', 'diblokir'),
  ('lombok-timur',   'Pemerintah Kabupaten Lombok Timur',       'Lombok Timur',  'kabupaten', 'https://portal.lomboktimurkab.go.id/semua-berita.html', 'bisa'),
  ('lombok-utara',   'Pemerintah Kabupaten Lombok Utara',       'Lombok Utara',  'kabupaten', 'https://lombokutarakab.go.id/', 'mati'),
  ('mataram',        'Pemerintah Kota Mataram',                 'Kota Mataram',  'kota',      'https://web.mataramkota.go.id/news/', 'diblokir'),
  ('sumbawa',        'Pemerintah Kabupaten Sumbawa',            'Sumbawa',       'kabupaten', 'https://setda.sumbawakab.go.id/berita/', 'diblokir'),
  ('sumbawa-barat',  'Pemerintah Kabupaten Sumbawa Barat',      'Sumbawa Barat', 'kabupaten', 'https://prokopim.sumbawabaratkab.go.id/category/berita/', 'bisa'),
  ('dompu',          'Pemerintah Kabupaten Dompu',              'Dompu',         'kabupaten', 'https://diskominfo.dompukab.go.id/berita', 'diblokir'),
  ('kabupaten-bima', 'Pemerintah Kabupaten Bima',               'Kabupaten Bima','kabupaten', 'https://diskominfostik.bimakab.go.id/id/news?sort=latest', 'diblokir'),
  ('kota-bima',      'Pemerintah Kota Bima',                    'Kota Bima',     'kota',      'https://kominfotik.bimakota.go.id/', 'diblokir')
on conflict (id) do nothing;
