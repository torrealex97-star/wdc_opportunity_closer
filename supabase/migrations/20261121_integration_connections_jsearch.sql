-- Admite la clave de JSearch (OpenWeb Ninja) en `integration_connections`. Sin esto, guardarla desde
-- Panel → APIs responde 503: el CHECK de 20261121_integration_connections_providers.sql admite once
-- proveedores y el insert choca con la restricción.
-- Aditiva y reversible: no toca filas, no activa gasto y no hace ninguna llamada a un proveedor.
-- Prueba: `tests/db/integration_connections_providers.sql` (BEGIN…ROLLBACK, incluye 'jsearch').
-- Reversión: volver al CHECK de once proveedores y borrar la fila de jsearch si existiera.
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('apify', 'serpapi', 'groq', 'openai', 'adzuna', 'jooble', 'infojobs', 'resend',
                      'brightdata', 'zenrows', 'scrapingbee', 'jsearch'));
