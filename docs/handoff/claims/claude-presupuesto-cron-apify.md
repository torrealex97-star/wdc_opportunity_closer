---
agent: claude
status: in_progress
branch: claude/presupuesto-cron-apify
touches: apps/web/lib/cronBudget.ts, apps/web/app/api/cron/collect/route.ts, tests/admin-auth/cronbudget.mjs, tests/admin-auth/flow.mjs, docs/STATUS.md
date: 2026-11-28
---
El cron anotaba «0 de 15 arrancó · sin tiempo en el presupuesto» en Apify (2026-11-27 y 28): las etapas anteriores se comían el reloj. Se reserva el tiempo de Apify cuando puede lanzar. No cambia gasto, límites ni qué portales corren.
