---
agent: buffy
status: in_progress
branch: feat/probe-company-pages
touches: scripts/probe_company_pages.mjs, .github/workflows/probe-company-pages.yml, tests/probe-company-pages.mjs, tests/admin-auth/run.sh, docs/evidence/company-pages-2026-11-22.md, docs/STATUS.md
date: 2026-11-22
---
Paquete **C1** de `docs/plans/OFERTAS_CLOSER_MEJORAS.md`: medir con internet las páginas de empleo que
vigila el motor, con el mismo extractor del cron y sin gastar. Informe real en `docs/evidence/`.

Hallazgo: `/v1/company-targets` no existe en el Worker hospedado (404), así que el cron solo lee las
páginas del repo. La sonda usa la lista semilla y lo declara; **no** se arregla esa ruta aquí (requiere
decidir de dónde lee el Worker y, si es una tabla, migración con orden del dueño).

No toca captación, matching, paneles ni migraciones. Sin gasto de pago.
