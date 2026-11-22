---
agent: buffy
status: validated
branch: fix/jsearch-billed-worstcase
pr:
touches: apps/web/app/api/admin/source-routes/route.ts
date: 2026-11-22
---
Alinea el comentario y la nota del error de la vía JSearch de `/api/admin/source-routes` con lo que hace
`billed`: un fallo sin respuesta (red, timeout) se cobra como peor caso, porque la petición pudo salir y
facturarse sin devolver estado. La nota distingue «fallo de red · se anota el peor caso» de «respuesta con
estado de error». No cambia el cobro, ni el tope, ni el resto de vías; siguiente acción, `verify` y
`web-admin` en verde y fusión con merge commit.
