---
agent: buffy
status: in_progress
branch: feat/fuentes-brightdata-jobspy
pr: —
touches: .github/workflows/jobspy-collect.yml, apps/web/app/api/admin/companies/, apps/web/app/api/admin/connections/route.ts, apps/web/app/api/admin/source-routes/, apps/web/app/globals.css, apps/web/components/AdminShell.tsx, apps/web/components/ApisTab.tsx, apps/web/components/CompanyPages.tsx, apps/web/components/SourceScorecard.tsx, apps/web/components/SourceSetupGuide.tsx, apps/web/components/SourcesCenter.tsx, apps/web/lib/companyWatchlist.ts, apps/web/lib/external.ts, apps/web/lib/integrations.ts, apps/web/lib/jobPosting.ts, apps/web/lib/providerBudget.ts, apps/web/lib/providers/, apps/web/lib/sourceRoutes.ts, apps/web/lib/sourceSetup.ts, docs/STATUS.md, docs/EXTERNAL_SOURCES.md, docs/SOURCES.md, docs/decisions/ADR-011-external-sources-tos.md, docs/decisions/ADR-021-cascada-de-rutas-por-fuente.md, scripts/jobspy_collect.py, supabase/migrations/20261121_provider_budget.sql, supabase/migrations/20261121_source_route_order.sql, tests/admin-auth/flow.mjs, tests/admin-auth/interactive.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/run.sh, tests/admin-auth/source-routes.mjs, tests/admin-auth/spend-window.mjs, tests/fixtures/bastida-careers.html, tests/test_jobspy_collect.py, docs/handoff/claims/buffy-fuentes-brightdata.md
date: 2026-11-21
---
Cerrar el panel de Fuentes con rutas por coste, Bright Data SERP/Unlocker, Empresas, guías y JobSpy al final. Incluye el tope mensual paginado sin el corte de 10.000, la última revisión derivada de ofertas/notas y las pruebas interactivas del Unlocker. Las migraciones quedan escritas y sin aplicar. No toca DDL ni despliegue.
