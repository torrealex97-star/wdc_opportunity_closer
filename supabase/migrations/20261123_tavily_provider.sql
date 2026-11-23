-- Tavily: buscador con IA. Entra como conexión (integration_connections) y como proveedor con tope mensual
-- (provider_budget). Sin ampliar los dos CHECK, guardar la clave o fijar su tope chocaría con la restricción.
-- Aditiva: no toca filas existentes ni siembra fila de tope (sin fila manda TAVILY_MONTHLY_USD o el defecto de 5 USD).
-- No hace ninguna llamada a un proveedor. Prueba: `tests/db/tavily_provider.sql` (BEGIN…ROLLBACK).
-- Reversión: borrar las filas con provider = 'tavily' y volver a los CHECK anteriores (20261122_rapidapi_provider.sql).
-- NO aplicada a la base real: requiere orden expresa del propietario (AGENTS.md).
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('apify', 'serpapi', 'groq', 'openai', 'adzuna', 'jooble', 'infojobs', 'resend', 'brightdata', 'zenrows', 'scrapingbee', 'jsearch', 'rapidapi', 'tavily'));

alter table public.provider_budget drop constraint if exists provider_budget_provider_check;
alter table public.provider_budget add constraint provider_budget_provider_check
  check (provider in ('brightdata', 'jsearch', 'rapidapi', 'serpapi', 'zenrows', 'scrapingbee', 'tavily'));
