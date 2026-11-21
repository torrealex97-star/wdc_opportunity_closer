---
agent: buffy
status: validated
branch: docs/relevo-sesiones-262-273
pr: 102
touches: docs/ACTIVE_HANDOFF.md, docs/STATUS.md, scripts/export_training_courses.py
date: 2026-11-21
---
Poner al día el relevo con las sesiones 262-273, borrar los 13 duplicados sin seguimiento del árbol y dejar `ruff` limpio (E741 en `scripts/export_training_courses.py`). No toca el código de la app ni el motor: el cambio de `scripts/` es el nombre de dos variables del mensaje del exportador y su salida es la misma. Sin DDL, sin despliegue y sin claves. PR #102 abierta; se fusiona con merge commit en cuanto `verify` y `web-admin` estén en verde en el head actual.
