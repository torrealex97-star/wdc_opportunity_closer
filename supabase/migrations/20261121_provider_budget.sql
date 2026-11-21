-- Tope mensual por proveedor de pago que no sea Apify (Bright Data, SerpApi, ZenRows, ScrapingBee).
--
-- APLICADA en Supabase real (proyecto closer-ia-ops, ref jzchuizybyubtkownhlw) el 2026-11-21,
-- versión 20261121180401. Prueba: `tests/db/provider_budget.sql` (BEGIN…ROLLBACK).
-- Ojo: hoy el tope efectivo lo sigue leyendo el entorno (`BRIGHTDATA_MONTHLY_USD` y sus equivalentes),
-- y el gasto se deriva de las notas de `external_ingest_runs` (`proveedor=… · coste_usd=…`).
-- El adaptador todavía NO lee `monthly_usd` de esta tabla; queda lista para cuando lo haga.
--
-- Una fila por organización y proveedor. El gasto NO se guarda aquí (se deriva de las ejecuciones,
-- que son la fuente de verdad); esta tabla solo fija el tope y quién lo cambió.
-- Se mantiene el mismo criterio que `paid_budget`: `org_id` es texto (la organización del producto),
-- sin clave foránea, para que la migración se pueda aplicar sin depender de otra tabla.
-- Reversión: `drop table if exists public.provider_budget;` (la app vuelve al valor del entorno).

create table if not exists public.provider_budget (
  org_id text not null default 'cloud-wdc',
  provider text not null check (provider in ('brightdata', 'serpapi', 'zenrows', 'scrapingbee')),
  monthly_usd numeric(10, 2) not null check (monthly_usd >= 0 and monthly_usd <= 5000),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

comment on table public.provider_budget is
  'Tope mensual declarado por proveedor de pago (sin Apify, que tiene paid_budget). El gasto se lee de external_ingest_runs; esta tabla no lo duplica.';

alter table public.provider_budget enable row level security;

-- Solo el service role del panel escribe o lee esta tabla; el navegador nunca la toca.
revoke all on public.provider_budget from anon, authenticated;

-- Semilla opcional e idempotente para la organización del producto. Ajusta los importes antes de aplicar.
insert into public.provider_budget (org_id, provider, monthly_usd)
values ('cloud-wdc', 'brightdata', 5), ('cloud-wdc', 'serpapi', 5), ('cloud-wdc', 'zenrows', 5), ('cloud-wdc', 'scrapingbee', 5)
on conflict (org_id, provider) do nothing;
