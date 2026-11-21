---
agent: buffy
status: in_progress
branch: feat/jsearch-cascada
touches: apps/web/lib/providers/jsearch.ts, apps/web/lib/sourceRoutes.ts, apps/web/lib/providerBudget.ts, apps/web/lib/integrations.ts, apps/web/app/api/admin/source-routes/route.ts, apps/web/app/api/admin/connections/route.ts, apps/web/components/ApisTab.tsx, supabase/migrations/20261121_integration_connections_jsearch.sql, tests/admin-auth/source-routes.mjs, tests/db/integration_connections_providers.sql, docs/decisions/ADR-021-cascada-de-rutas-por-fuente.md, docs/EXTERNAL_SOURCES.md, docs/STATUS.md
date: 2026-11-21
---

Añade JSearch (OpenWeb Ninja) como escalón de Google Jobs entre Bright Data y SerpApi: 0,0025 USD por
petición, clave propia en Panel → APIs, tope `JSEARCH_MONTHLY_USD` en `providerBudget`, ejecución en «Probar
ruta» con su nota de gasto, y prueba de que sustituye a SerpApi sin cambiar el orden por coste (Bright Data
0,0015 → JSearch 0,0025 → SerpApi 0,025). Incluye la migración que admite `jsearch` en el `CHECK` de
`integration_connections`, sin la cual guardar la clave respondería 503.

**No hace**: no cambia el cron de SerpApi (sigue recogiendo por SerpApi hasta que se cambie a propósito), no
toca las claves ya guardadas, no página nunca (una página es una petición de pago) y no hace llamadas reales
al proveedor. **Límite**: no hay clave de OpenWeb Ninja en este entorno, así que el contrato se prueba con
`fetch` simulado y un fixture con la forma documentada.
