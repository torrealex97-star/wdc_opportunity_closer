-- Orden personalizado de las vías de una fuente (Bright Data, SerpApi, Apify, JobSpy…).
--
-- Sin fila o con `route_order = '{}'`, la app usa el orden por coste de `sourceRoutes.ts`
-- (API/feed gratis → API oficial → Bright Data → SerpApi → Apify → JobSpy → Unlocker).
-- El override solo cambia el orden de esa fuente; JobSpy y el hueco agéntico siguen siempre al final.
--
-- Escrita y SIN APLICAR: el DDL real lo autoriza el propietario. Hasta entonces la API de órdenes
-- responde 503 al guardar y el panel sigue mostrando el orden por coste.

alter table public.source_settings
  add column if not exists route_order text[] not null default '{}';

comment on column public.source_settings.route_order is
  'Ids de ruta (fuente:proveedor) en el orden elegido por el operador. Vacío = orden por coste.';
