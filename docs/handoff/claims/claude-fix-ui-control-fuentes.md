---
agent: claude
status: in_progress
branch: claude/fix-ui-control-fuentes
touches: tests/admin-auth/ui.mjs, docs/STATUS.md
date: 2026-11-24
---
El paso de interfaz «Resumen: control de fuentes» falló en CI 2 de 3 veces sobre el mismo commit (PR #176) sin decir en qué pantalla estaba la página.
Se espera 10 s, se reintenta la navegación por hash una vez y, si falla, el error nombra la pantalla real. No es causa raíz demostrada: la diagnosis llega con el siguiente fallo.
