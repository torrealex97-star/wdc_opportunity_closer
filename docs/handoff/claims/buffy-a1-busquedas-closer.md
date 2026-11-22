---
agent: buffy
status: validated
branch: feat/apify-busquedas-closer
pr: 135
touches: apps/web/lib/apifyCatalog.ts, apps/web/lib/apifyAuto.ts, tests/admin-auth/apify-queries.mjs, tests/admin-auth/workana.mjs, tests/admin-auth/run.sh, tests/test_apify_portals.py, docs/STATUS.md
date: 2026-11-22
---
Paquete **A1** de `docs/plans/OFERTAS_CLOSER_MEJORAS.md`: búsquedas de closer correctas en LinkedIn y
Workana. Rota un término canónico al día (una ejecución diaria, mismo coste), sustituye el actor de
LinkedIn que devolvía 404 y da a cada repuesto de Workana la plantilla de su propio esquema.

No toca A2/A3/B1/D1/C3 (PR #134 de Claude) ni recorta, pausa o baja el tope de ninguna fuente: la
muestra de LinkedIn/Workana sigue siendo insuficiente y la decisión es del dueño.

Pendiente y bloqueado: la prueba real con `max_items=10` y la revisión a mano de la muestra exigen
gasto de Apify (orden del dueño). Sin ella no se declara que las búsquedas nuevas traigan mejores
ofertas, solo que el input que se manda es el correcto.
