-- JSearch también se paga por petición (0,0025 USD), así que entra en la tabla de topes con su fila.
-- El CHECK de 20261121_provider_budget.sql solo admite cuatro proveedores: sin ampliarlo, la fila de
-- jsearch choca y su tope quedaría solo en el entorno, sin poder fijarlo por organización.
-- Aditiva: no toca las filas existentes (do nothing si ya hay una). Prueba: `tests/db/provider_budget.sql`.
-- Reversión: borrar la fila de jsearch y volver al CHECK de cuatro proveedores.
alter table public.provider_budget drop constraint if exists provider_budget_provider_check;
alter table public.provider_budget add constraint provider_budget_provider_check
  check (provider in ('brightdata', 'jsearch', 'serpapi', 'zenrows', 'scrapingbee'));

insert into public.provider_budget (org_id, provider, monthly_usd)
values ('cloud-wdc', 'jsearch', 5)
on conflict (org_id, provider) do nothing;
