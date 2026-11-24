-- Consumo real de la voz continua (ADR-015): una fila por sesión, con segundos y coste estimado en el peor caso del proveedor.
-- Sirve para el tope de 10 minutos por alumna y día y para el tope global mensual de voz. NO guarda audio ni texto.
-- Aditiva y reversible (drop table). Solo la clave de servicio accede: RLS activada y sin políticas.
-- Prueba: tests/db/voice_usage.sql (BEGIN…ROLLBACK).
create table if not exists public.voice_usage (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  student_id uuid not null references public.students(id) on delete cascade,
  day date not null default ((now() at time zone 'utc')::date),
  provider text not null check (length(provider) between 1 and 40),
  seconds integer not null check (seconds between 1 and 600),
  cost_usd numeric(10,4) not null check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists voice_usage_org_day_idx on public.voice_usage (org_id, day);
create index if not exists voice_usage_student_day_idx on public.voice_usage (org_id, student_id, day);
alter table public.voice_usage enable row level security;
revoke all on public.voice_usage from anon, authenticated;
