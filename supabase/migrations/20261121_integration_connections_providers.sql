-- Amplía el CHECK de proveedores de `integration_connections` con las tres claves nuevas del panel
-- (Bright Data, ZenRows y ScrapingBee). Sin esto, guardar cualquiera de ellas responde 503: el CHECK de
-- 20261026_integration_resend.sql solo admite ocho proveedores y el insert choca con la restricción.
-- Aditiva y reversible: no toca filas, no activa gasto y no hace ninguna llamada a un proveedor.
-- Prueba: `tests/db/integration_connections_providers.sql` (BEGIN…ROLLBACK).
-- Reversión: volver al CHECK de ocho proveedores y borrar las tres filas si existieran.
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('apify', 'serpapi', 'groq', 'openai', 'adzuna', 'jooble', 'infojobs', 'resend',
                      'brightdata', 'zenrows', 'scrapingbee'));
