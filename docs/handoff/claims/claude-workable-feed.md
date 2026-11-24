---
agent: claude
status: in_progress
branch: claude/workable-feed
touches: scripts/workable_collect.py, tests/test_workable_collect.py, .github/workflows/workable-collect.yml, docs/STATUS.md
date: 2026-11-24
---
Recolector del feed público XML de Workable (todas sus empresas) -> borradores. Filtra por rol (vocabulario canónico) y mercado ES/LatAm,
enriquece la descripción con la API pública de la ficha (sin verificar) y declara `truncated` si el feed se corta.
