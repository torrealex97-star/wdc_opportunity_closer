---
agent: claude
status: validated
branch: claude/dreamy-mendel-wcqit9
touches: apps/web/lib/googleJobs.ts, tests/admin-auth/googlejobs.mjs, apps/web/lib/offerPay.ts, tests/admin-auth/offerpay.mjs, docs/decisions/ADR-022-portal-de-empresas.md, apps/web/lib/sourceSample.ts, apps/web/lib/formatInt.ts, apps/web/components/SourceSample.tsx, apps/web/components/ApisTab.tsx, apps/web/app/api/admin/source-sample/, tests/admin-auth/sourcesample.mjs, docs/plans/OFERTAS_CLOSER_MEJORAS.md
date: 2026-11-22
---
Paquetes A2, A3, B1, D1 y «Probar ruta» recoge de verdad (cascada, motor, Apify) del plan `docs/plans/OFERTAS_CLOSER_MEJORAS.md` y borrador de C3 (ADR-022): panel «Muestra por fuente» (1.000 ofertas antes de juzgar una fuente de pago), medición del tope de 300, Google Jobs en 7 países, comisión/OTE/ticket por reglas y propuesta del portal de empresas. Solo lectura: no pausa ni recorta ninguna fuente. Al fusionarse: borrar esta ficha y anotar el resultado en `docs/handoff/archive/2026-11.md`. Siguiente: **H (panel de control: menú, tabla maestra de fuentes)**, D2 y D3 (claude); A1 (búsquedas de closer de LinkedIn y Workana) fija `SAMPLE_SINCE`; necesita la autorización del dueño para el gasto de las pruebas reales.
