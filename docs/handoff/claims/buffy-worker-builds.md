---
agent: buffy
status: blocked
branch: main (cambio solo de documentación; sin rama)
pr: —
touches: docs/STATUS.md, docs/handoff/claims/buffy-worker-builds.md
date: 2026-11-21
---
El check «Workers Builds: closer-web» sigue en rojo en `main` y su configuración vive solo en Cloudflare (no hay nada en el repositorio que la defina). Bloqueado: falta que el propietario desconecte la conexión de Git del Worker `closer-web` o deje un token *user-scoped* con «Workers Builds Configuration: Edit» en `.local/cf-builds.token`. La siguiente acción exacta y las comprobaciones de hoy están en la entrada de la sesión 274 de `docs/STATUS.md`. No toca código ni configuración de despliegue.
