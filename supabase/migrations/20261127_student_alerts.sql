-- Avisos rápidos por email a las alumnas (incremento 3). DOS tablas, ambas solo con clave de servicio (RLS activada y sin políticas):
--  · student_alert_prefs: el consentimiento EXPLÍCITO y APARTE (casilla propia, revocable). Sin fila o con opted_in_at nulo no se envía nada.
--  · student_alerts: cola de avisos. Único (org, alumna, oferta): una oferta se avisa una sola vez por alumna. Estados: pending → sending (reclamo
--    atómico: solo envía quien lo reclama) → sent | failed | skipped. Aditiva y reversible (drop table).
-- Prueba: tests/db/student_alerts.sql (BEGIN…ROLLBACK).
create table if not exists public.student_alert_prefs (
  org_id text not null default 'cloud-wdc',
  user_id uuid not null,
  opted_in_at timestamptz,
  opt_in_version text check (opt_in_version is null or char_length(opt_in_version) between 1 and 40),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id),
  check (opted_in_at is null or opt_in_version is not null)
);
create table if not exists public.student_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  user_id uuid not null,
  offer_id text not null check (char_length(offer_id) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, user_id, offer_id)
);
create index if not exists student_alerts_day_idx on public.student_alerts (org_id, user_id, created_at desc);
create index if not exists student_alerts_status_idx on public.student_alerts (org_id, status, created_at desc);
alter table public.student_alert_prefs enable row level security;
alter table public.student_alerts enable row level security;
revoke all on public.student_alert_prefs from anon, authenticated;
revoke all on public.student_alerts from anon, authenticated;
