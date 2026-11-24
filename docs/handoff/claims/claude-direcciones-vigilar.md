---
agent: claude
status: in_progress
branch: claude/direcciones-vigilar
touches: apps/web/lib/sourceTargets.ts, apps/web/lib/sourceTargetsStore.ts, apps/web/lib/apify.ts, apps/web/lib/sourceControl.ts, apps/web/lib/sourceControlData.ts, apps/web/components/SourceTargets.tsx, apps/web/components/AdminShell.tsx, apps/web/app/api/admin/source-targets/route.ts, supabase/migrations/20261124_source_targets.sql, tests/db/source_targets.sql, tests/admin-auth/sourcetargets.mjs, tests/admin-auth/sourcecontrol.mjs, tests/admin-auth/apify-inputs.mjs, tests/admin-auth/flow.mjs, tests/admin-auth/ui.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/run.sh, docs/STATUS.md
date: 2026-11-24
---
Direcciones a vigilar editables desde la app (Facebook, Skool, Telegram): tabla `source_targets`, validador por fuente, API (solo el propietario escribe), conexión con los actores (`{{start_urls}}`), Control de fuentes dinámico y pantalla en «Búsqueda automática». La migración se aplica tras la prueba BEGIN…ROLLBACK (autorizada por el propietario).
