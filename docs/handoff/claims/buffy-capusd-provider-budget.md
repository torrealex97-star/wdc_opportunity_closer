---
agent: buffy
status: in_progress
branch: feat/capusd-provider-budget
pr:
touches: apps/web/lib/providerBudget.ts, apps/web/lib/providerBudgetStore.ts, apps/web/lib/integrations.ts, apps/web/app/api/admin/source-routes/route.ts, tests/admin-auth/provider-budget-org.mjs, tests/admin-auth/run.sh, supabase/migrations/20261121_provider_budget.sql, docs/ACTIVE_HANDOFF.md, docs/EXTERNAL_SOURCES.md, docs/OWNER_GUIDE.md, docs/decisions/ADR-011-external-sources-tos.md, docs/decisions/ADR-021-cascada-de-rutas-por-fuente.md
date: 2026-11-21
depends_on:
---
Conecta el tope de los proveedores de pago (Bright Data, SerpApi, ZenRows, ScrapingBee) a `provider_budget`
por organización, con el entorno como respaldo declarado, y añade su prueba: cambiar `monthly_usd` cambia el
tope efectivo. NO hay DDL, ni cambio de importes en la base real, ni gasto nuevo: la lectura se prueba con
PostgREST simulado. Siguiente acción: `verify` y `web-admin` en verde, merge con merge commit y publicar el
panel para que el dominio sirva el build nuevo.
