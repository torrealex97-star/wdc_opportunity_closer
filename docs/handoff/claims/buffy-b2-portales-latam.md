---
agent: buffy
status: in_progress
branch: feat/latam-portales
touches: apps/web/lib/jobPortals.ts, tests/admin-auth/fallback.mjs, docs/STATUS.md
date: 2026-11-22
---
Paquete **B2** de `docs/plans/OFERTAS_CLOSER_MEJORAS.md`: verificar el patrón de URL de oferta de
Computrabajo, OCC y Bumerán. Se corrigió el TLD de país que descartaba anuncios reales y se endureció
OCC a la ficha (`/empleo/oferta/`).

No se mide el volumen por Bright Data/SerpApi: sin clave real y con gasto sujeto a orden del dueño.
El catálogo de fuentes sigue «sin proveedor verificado»; un patrón correcto no valida un conector.
