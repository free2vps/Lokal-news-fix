-- Run once in the existing Supabase project's SQL editor. No existing table is deleted.
begin;
create table if not exists public.content_hub_cache (
  key text primary key check (key in ('recommended','x-trends','youtube-music')),
  payload jsonb not null,
  imported_at timestamptz not null default now()
);
alter table public.content_hub_cache enable row level security;
revoke all on public.content_hub_cache from anon, authenticated;
grant select, insert, update on public.content_hub_cache to service_role;
create table if not exists public.content_hub_leases (
  key text primary key,
  owner uuid not null,
  expires_at timestamptz not null
);
alter table public.content_hub_leases enable row level security;
revoke all on public.content_hub_leases from anon, authenticated;
grant select,insert,update,delete on public.content_hub_leases to service_role;
create or replace function public.acquire_content_hub_lease(lease_owner uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  insert into public.content_hub_leases as l(key,owner,expires_at)
  values('import',lease_owner,now()+interval '2 minutes')
  on conflict(key) do update set owner=excluded.owner,expires_at=excluded.expires_at
  where l.expires_at<now();
  return found;
end; $$;
create or replace function public.release_content_hub_lease(lease_owner uuid)
returns void language sql security invoker set search_path=public as $$
 delete from public.content_hub_leases where key='import' and owner=lease_owner;
$$;
revoke all on function public.acquire_content_hub_lease(uuid) from public, anon, authenticated;
revoke all on function public.release_content_hub_lease(uuid) from public, anon, authenticated;
grant execute on function public.acquire_content_hub_lease(uuid) to service_role;
grant execute on function public.release_content_hub_lease(uuid) to service_role;
commit;
-- articles.source_url must already have a UNIQUE constraint (required by existing pipeline too).
-- source_id must be nullable or have an appropriate default for imports without a local source record.
