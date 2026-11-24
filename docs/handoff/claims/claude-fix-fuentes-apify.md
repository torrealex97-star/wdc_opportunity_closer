---
agent: claude
status: in_progress
branch: claude/fix-fuentes-apify
touches: apps/web/lib/apifyCatalog.ts, apps/web/lib/apify.ts, tests/admin-auth/apify-inputs.mjs, docs/STATUS.md
date: 2026-11-24
---
Arreglo de extracción medido el 2026-11-24: `apify-company` (100 vistas, 0 aprobadas: 90 «Personal Trainer» sin descripción) pasa a
`fantastic-jobs/greenhouse-jobs-api` primero (búsqueda por título); Elempleo pasa a `scrapers_lat` primero (con descripción);
`raw.item_keys` para diagnosticar desde la base. Se da por bueno solo si la medida del día siguiente mejora.
