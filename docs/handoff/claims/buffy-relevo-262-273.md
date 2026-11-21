---
agent: buffy
status: in_progress
branch: docs/relevo-sesiones-262-273
pr: —
touches: docs/ACTIVE_HANDOFF.md, docs/STATUS.md, scripts/export_training_courses.py
date: 2026-11-21
---
Poner al día el relevo con las sesiones 262-273, borrar los 13 duplicados sin seguimiento del árbol y dejar `ruff` limpio (E741 en `scripts/export_training_courses.py`). No toca el código de la app ni el motor: el cambio de `scripts/` es el nombre de dos variables del mensaje del exportador y su salida es la misma. Sin DDL, sin despliegue y sin claves. Siguiente acción: abrir la PR, esperar `verify` y `web-admin` en verde y fusionar con merge commit.
