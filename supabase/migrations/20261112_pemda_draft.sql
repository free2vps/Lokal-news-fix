-- DRAF TAUTAN PEMDA.
-- Tautan yang ditempel pemilik disadur (ringkasan setia + atribusi + tautan asli) lalu
-- masuk tabel ini sebagai DRAF. Tidak ada penerbitan otomatis: pemilik yang menyetujui.
-- Bila ditolak, alamatnya tetap tercatat supaya tautan yang sama tidak ditawarkan berulang.
create table if not exists public.pemda_draft (
  id           bigint generated always as identity primary key,
  sumber_url   text not null unique,
  judul        text not null,
  ringkasan    text not null,
  tanggal_sumber date,
  gambar_url   text,
  sumber_nama  text not null,
  status       text not null default 'draf' check (status in ('draf','disetujui','ditolak')),
  slug_artikel text,
  dibuat_at    timestamptz not null default now(),
  diputuskan_at timestamptz
);

create index if not exists pemda_draft_status_idx on public.pemda_draft (status, dibuat_at desc);

-- Draf adalah ruang kerja internal: tidak ada policy baca publik.
-- Backend memakai service role (melewati RLS), jadi tidak ada yang perlu ditambah.
alter table public.pemda_draft enable row level security;
