-- Envíos del formulario público de empleadores (/empleadores): quién envió qué y desde dónde, para frenar abusos y poder escribir a la empresa.
-- El CONTACTO (nombre y email) vive SOLO aquí, nunca en la oferta que ve la alumna. La IP no se guarda: solo un hash diario (sirve para el
-- límite por origen, no para identificar). Aditiva y reversible (drop table). Solo la clave de servicio accede: RLS activada y sin políticas.
-- Prueba: tests/db/employer_submissions.sql (BEGIN…ROLLBACK).
create table if not exists public.employer_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  offer_external_id text not null check (offer_external_id ~ '^emp-[0-9a-f]{16}$'),
  company text not null check (char_length(company) between 2 and 120),
  contact_name text not null check (char_length(contact_name) between 2 and 80),
  contact_email text not null check (char_length(contact_email) between 6 and 120 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  offer_url text not null check (char_length(offer_url) <= 500 and offer_url ~ '^https://'),
  ip_hash text not null check (char_length(ip_hash) between 16 and 64),
  created_at timestamptz not null default now(),
  unique (org_id, offer_external_id)
);
create index if not exists employer_submissions_ip_idx on public.employer_submissions (org_id, ip_hash, created_at desc);
create index if not exists employer_submissions_email_idx on public.employer_submissions (org_id, contact_email, created_at desc);
alter table public.employer_submissions enable row level security;
revoke all on public.employer_submissions from anon, authenticated;
