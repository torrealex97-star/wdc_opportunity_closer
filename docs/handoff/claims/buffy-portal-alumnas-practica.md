---
agent: buffy
status: validated
branch: feat/portal-alumnas-practica
pr: 97
touches: apps/web/components/, apps/web/lib/, apps/web/app/api/practice/, apps/web/app/globals.css, tests/browser/, tests/admin-auth/practice-rubrics.mjs
date: 2026-11-20
---
Once commits sobre `main`: currículo de Formación alineado con las skills, frase diaria por cuenta, tabla de criterios apilada, historial de cambios de criterios, menú con Práctica/Entrevistas/Revisión de llamada, revisión de llamada con audio/enlace/transcripción y nota por paso, filtros de modalidad/prospección reordenados, y suite E2E con escrituras aisladas que verifica que `next-env.d.ts` y `tsconfig.json` vuelven a sus bytes versionados (sin pisar ediciones locales).

Verificación: backend `practice-rubrics.mjs` 15/15, `npm run typecheck` y `npm run design` PASS, Playwright 55 pasan / 6 omitidas, `admin-practice.spec.ts` tres veces verde y `git status` limpio tras la suite.

No incluye: despliegue (producción sirve un build anterior), migraciones ni secretos. Sin probar: audio real, enlaces reales de Fathom/Drive/YouTube y el análisis con modelo real; las specs simulan el proveedor.

Siguiente acción exacta: revisión del dueño en la PR 97. Al fusionarla, borrar esta ficha y anotar la línea en `docs/handoff/archive/2026-11.md`.
