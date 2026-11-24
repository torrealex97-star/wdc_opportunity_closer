---
agent: claude
status: in_progress
branch: claude/panel-motor-real
pr: 0
touches: apps/web/lib/engineSources.ts, apps/web/lib/sourceSample.ts, apps/web/components/SourcesEngine.tsx, tests/admin-auth/enginesources.mjs, tests/admin-auth/flow.mjs, tests/admin-auth/ui.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/run.sh, docs/STATUS.md
date: 2026-11-24
---
El panel de fuentes gratuitas leía 0 porque contaba external_offers de Supabase; ahora lee el informe real del motor (catálogo, elegibles, último run y causa del fallo).
