-- RapidAPI: UNA clave (X-RapidAPI-Key) para todas las APIs de empleo del marketplace. Entra como conexión
-- (integration_connections) y como proveedor con tope mensual (provider_budget). Sin ampliar los dos CHECK, guardar
-- la clave o fijar su tope chocaría con la restricción.
-- Aditiva: no toca filas existentes. No siembra fila de tope (sin fila manda el entorno RAPIDAPI_MONTHLY_USD o el
-- defecto de 5 USD, y una fila sembrada sin updated_by se ignora). Prueba: `tests/db/rapidapi_provider.sql`.
-- Reversión: borrar las filas con provider = 'rapidapi' y volver a los CHECK anteriores.
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('apify', 'serpapi', 'groq', 'openai', 'adzuna', 'jooble', 'infojobs', 'resend', 'brightdata', 'zenrows', 'scrapingbee', 'jsearch', 'rapidapi'));

alter table public.provider_budget drop constraint if exists provider_budget_provider_check;
alter table public.provider_budget add constraint provider_budget_provider_check
  check (provider in ('brightdata', 'jsearch', 'rapidapi', 'serpapi', 'zenrows', 'scrapingbee'));
