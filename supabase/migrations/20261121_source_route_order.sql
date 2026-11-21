-- Orden personalizado de las vías de una fuente (Bright Data, SerpApi, Apify, JobSpy…).
--
-- Sin fila o con `route_order = '{}'`, la app usa el orden por coste de `sourceRoutes.ts`
-- (API/feed gratis → API oficial → Bright Data → SerpApi → Apify → JobSpy → Unlocker).
-- El override solo cambia el orden de esa fuente; JobSpy y el hueco agéntico siguen siempre al final.
--
-- APLICADA en Supabase real (proyecto closer-ia-ops, ref jzchuizybyubtkownhlw) el 2026-11-21,
-- versión 20261121180440. Prueba: `tests/db/source_route_order.sql` (BEGIN…ROLLBACK).
-- Desde ahora la API de órdenes guarda en esta columna y el panel persiste el orden por fuente.

alter table public.source_settings
  add column if not exists route_order text[] not null default '{}';

comment on column public.source_settings.route_order is
  'Ids de ruta (fuente:proveedor) en el orden elegido por el operador. Vacío = orden por coste.';
