-- Direcciones a vigilar por fuente (grupos y páginas de Facebook, comunidades de Skool, canales públicos de Telegram).
-- Las edita el propietario desde Fuentes → «Direcciones a vigilar» y alimentan `startUrls`/`profiles` de los actores de Apify.
-- NO guarda credenciales ni cookies (esas van al almacén de claves). Aditiva y reversible (drop table).
-- Solo la clave de servicio accede: RLS activada y sin políticas. Prueba: tests/db/source_targets.sql (BEGIN…ROLLBACK).
create table if not exists public.source_targets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  source text not null check (source ~ '^[a-z0-9-]{2,40}$'),
  kind text not null check (kind in ('facebook_group', 'facebook_page', 'skool_community', 'telegram_channel')),
  url text not null check (char_length(url) between 8 and 500 and url ~ '^https://'),
  label text check (label is null or char_length(label) <= 120),
  enabled boolean not null default true,
  created_by text check (created_by is null or char_length(created_by) <= 254),
  created_at timestamptz not null default now(),
  unique (org_id, source, url)
);
create index if not exists source_targets_org_source_idx on public.source_targets (org_id, source) where enabled;
alter table public.source_targets enable row level security;
revoke all on public.source_targets from anon, authenticated;
