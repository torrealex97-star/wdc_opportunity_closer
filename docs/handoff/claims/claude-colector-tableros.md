---
agent: claude
status: in_progress
branch: claude/colector-tableros
touches: scripts/boards_collect.py, scripts/boards_seed.json, .github/workflows/boards-collect.yml, tests/test_boards_collect.py, apps/web/lib/sourceControlData.ts, tests/admin-auth/flow.mjs, docs/REFERENCIAS_SCRAPERS.md, docs/STATUS.md
date: 2026-11-27
---
Colector directo de tableros de empresas (Greenhouse, Ashby, SmartRecruiters, Recruitee, Teamtailor) en GitHub Actions, con semilla MIT de career-ops. Solo probado con respuestas de muestra: los hosts están bloqueados desde el entorno de desarrollo; la primera ejecución real es con dry_run=1. Lever/Personio/BambooHR y detección de ATS quedan para T3.
