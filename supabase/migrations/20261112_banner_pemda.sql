-- BANNER / PENGUMUMAN PEMDA (pilihan A: satu slot tetap di beranda).
-- Diisi pemilik dari panel Hub: judul, gambar, tautan, masa tayang.
-- Dijalankan di Supabase (project yang sama dengan tabel articles).
create table if not exists public.banner_pemda (
  id          bigint generated always as identity primary key,
  judul       text not null,
  gambar_url  text not null,           -- hanya https, tidak disalin/di-rehost
  tautan      text,                    -- alamat tujuan (situs pemda / halaman promo)
  aktif       boolean not null default true,
  mulai       date,
  selesai     date,
  urutan      integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists banner_pemda_aktif_idx on public.banner_pemda (aktif, urutan);

-- Halaman publik hanya membaca. Penulisan dilakukan backend memakai service role.
alter table public.banner_pemda enable row level security;
drop policy if exists "banner publik dibaca" on public.banner_pemda;
create policy "banner publik dibaca" on public.banner_pemda for select using (true);
