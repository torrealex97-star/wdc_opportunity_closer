---
agent: buffy
status: validated
branch: fix/zonas-cache
pr: 115
touches: apps/web/lib/providers/brightdata.ts, apps/web/lib/integrations.ts, apps/web/app/api/admin/source-routes/route.ts, tests/admin-auth/source-routes.mjs, docs/EXTERNAL_SOURCES.md, docs/STATUS.md
date: 2026-11-21
---
Que el panel deje de pedir las zonas de Bright Data en cada carga cuando la clave está guardada sin zona:
se cachean 10 minutos en el proceso (`resolveBrightDataConfig`, TTL, fallo no cacheado) y guardar o borrar
la clave tira la caché; «Probar» pregunta siempre a la cuenta. No cambia lo que se guarda, ni gasta (la
consulta de zonas es gratis), ni cambia el comportamiento cuando las zonas vienen escritas en el secreto.
NO se persisten zonas en la base: eso pediría DDL y orden del dueño.
