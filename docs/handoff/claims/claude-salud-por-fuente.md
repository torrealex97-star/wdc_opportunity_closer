---
agent: claude
status: in_progress
branch: claude/dreamy-mendel-wcqit9
pr: 0
touches: apps/web/lib/sourceHealth.ts, apps/web/lib/sourceSample.ts, apps/web/components/SourceSample.tsx, apps/web/lib/apify.ts, apps/web/app/api/cron/collect/route.ts, apps/web/lib/external.ts, apps/web/lib/funnel.ts, tests/admin-auth/sourcehealth.mjs, docs/STATUS.md
date: 2026-11-23
---
Fase 1 del plan «todas las fuentes bien conectadas» (decisión del dueño, 2026-11-23): salud por fuente.
Dice si cada fuente está bien CONECTADA para poder dar ofertas y, si no, por qué. No juzga rendimiento
(eso, con ≥1.000 ofertas). Fases siguientes: 2 reconectar Apify roto (pruebas ≤5 US$), 3 mínimo diario
+ tope global/individual, 4 calidad de lo recogido, 5 las 14 fuentes sin vía.
