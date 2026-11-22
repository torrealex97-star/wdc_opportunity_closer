---
agent: buffy
status: validated
branch: fix/cron-jsearch-cascada
pr: 123
touches: apps/web/lib/googleJobs.ts, apps/web/lib/providers/jsearch.ts, apps/web/app/api/admin/waterfall/route.ts, apps/web/app/api/cron/collect/route.ts, apps/web/components/SourceIdeas.tsx, tests/admin-auth/googlejobs.mjs, docs/EXTERNAL_SOURCES.md
date: 2026-11-22
---
Pasa la recogida de los 7 dorks del cron de Google Jobs a JSearch (0,0025 USD) entre Bright Data y SerpApi,
con su tope (`JSEARCH_MONTHLY_USD` / `provider_budget`), su 429 (sin reintento, reserva devuelta y respaldo)
y su prueba. No toca el respaldo por portal ni la vía manual del motor Python.
