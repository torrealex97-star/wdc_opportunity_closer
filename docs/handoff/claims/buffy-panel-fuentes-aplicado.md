---
agent: buffy
status: validated
branch: docs/panel-fuentes-aplicado
pr: 106
touches: docs/ACTIVE_HANDOFF.md, docs/STATUS.md, docs/OWNER_GUIDE.md, docs/EXTERNAL_SOURCES.md, docs/decisions/ADR-011-external-sources-tos.md, docs/decisions/ADR-021-cascada-de-rutas-por-fuente.md, docs/handoff/archive/2026-11.md, supabase/migrations/20261121_provider_budget.sql, supabase/migrations/20261121_source_route_order.sql, tests/db/provider_budget.sql, tests/db/source_route_order.sql, docs/handoff/claims/buffy-panel-fuentes-aplicado.md
date: 2026-11-21
---
Subir en una PR el trabajo pendiente de la sesión 282 —las dos migraciones ya aplicadas en `closer-ia-ops`, sus
pruebas `BEGIN…ROLLBACK` nuevas, los documentos que declaran la versión aplicada, la guía del dueño con las
tareas 3 y 20— junto con la corrección de la tarea 20 del relevo: la tabla `provider_budget` no manda todavía
sobre el tope porque `capUsd()` lee solo el entorno. No toca código de la app, ni despliegue, ni claves.

PR #106 abierta; a la espera de `verify` y `web-admin` verdes en el head para fusionar con merge commit
y dejar en `main` la ficha borrada, la línea del archivo y la entrada de cierre en `STATUS`.
