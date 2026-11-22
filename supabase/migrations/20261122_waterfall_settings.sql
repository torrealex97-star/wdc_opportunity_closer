-- Objetivo diario de ofertas CUALIFICADAS del waterfall de recogida.
--
-- Una oferta cualificada es la que ya está aprobada o publicada (`external_offers.editorial_status in
-- ('approved','published')`), es decir, la que la alumna puede ver. El waterfall recorre las vías de pago por
-- coste (Google Jobs: Bright Data → SerpApi; respaldo por portal; actores de Apify) y PARA cuando la cuenta del
-- día alcanza este objetivo o se agota el tope mensual de cada proveedor (`provider_budget`, `paid_budget`).
--
-- Una fila por organización. Sin fila = objetivo sin configurar: el cron usa la variable de entorno
-- `DAILY_TARGET_OFFERS` y lo declara (no se inventa un número). `0` es válido y significa «no se gasta en vías de
-- pago»; el límite superior (10.000) solo evita un tecleo accidental.
-- Orden del propietario recibida en la sesión del 2026-11-22 («sí, hazlo»); aplicada en la base real con prueba
-- `tests/db/waterfall_settings.sql` (BEGIN…ROLLBACK) y asesores de Supabase después.
-- Reversión: `drop table if exists public.waterfall_settings;` (la app vuelve al valor del entorno).

create table if not exists public.waterfall_settings (
  org_id text primary key default 'cloud-wdc',
  qualified_per_day integer not null check (qualified_per_day >= 0 and qualified_per_day <= 10000),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

comment on table public.waterfall_settings is
  'Objetivo diario de ofertas cualificadas (aprobadas o publicadas) del waterfall. Sin fila: variable de entorno DAILY_TARGET_OFFERS.';

alter table public.waterfall_settings enable row level security;

-- Solo el service role del panel lee o escribe esta tabla; el navegador nunca la toca.
revoke all on public.waterfall_settings from anon, authenticated;
