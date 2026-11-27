---
agent: claude
status: in_progress
branch: claude/causa-apify-rechazo
touches: apps/web/lib/apifyErrors.ts, apps/web/lib/apify.ts, apps/web/lib/spendFloor.ts, tests/admin-auth/apifyerror.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/flow.mjs, tests/admin-auth/run.sh, docs/STATUS.md
date: 2026-11-27
---
El cron del 2026-11-27 no arrancó ningún portal de Apify y la app lo etiquetaba siempre «rechazó la clave». Se registra el motivo real que devuelve Apify (tipo y mensaje) y la causa común se dice una vez en la nota del cron. No cambia ningún límite ni gasto.
