---
agent: claude
status: in_progress
branch: claude/dreamy-mendel-wcqit9
pr: 0
touches: apps/web/lib/runOutcome.ts, apps/web/components/SourcesCenter.tsx, apps/web/app/api/admin/source-routes/route.ts, tests/admin-auth/runoutcome.mjs, tests/admin-auth/interactive.mjs, docs/STATUS.md
date: 2026-11-23
---
«Probar ruta» con Apify nunca decía si recogió: la prueba es asíncrona y el panel no volvía a mirar. Ahora sigue la
ejecución hasta decir cuántas ofertas recogió (con muestra), por qué falló o que terminó sin ofertas.
