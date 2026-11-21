---
agent: buffy
status: in_progress
branch: fix/claves-proveedores-nuevos
touches: apps/web/lib/integrations.ts, apps/web/app/api/admin/connections/route.ts, supabase/migrations/20261121_integration_connections_providers.sql, tests/db/integration_connections_providers.sql, tests/admin-auth/flow.mjs, docs/STATUS.md, docs/handoff/archive/2026-11.md
date: 2026-11-21
---

Arregla que las claves nuevas del panel (Bright Data, ZenRows y ScrapingBee) no se guarden: el `CHECK` de
`integration_connections` en la base real seguía admitiendo solo ocho proveedores y el insert fallaba con
`23514`. Incluye la migración que amplía el CHECK, su prueba `BEGIN…ROLLBACK`, el mensaje 503 con el nombre de
la migración que falta, los últimos 4 caracteres de la CLAVE de Bright Data (no de la zona) y el rechazo de
nombres heredados del prototipo (`toString`) como proveedor.

**No hace**: no cambia el formato de ninguna clave, no activa gasto, no hace llamadas reales a ningún proveedor
y no toca las claves ya guardadas. **Límite**: no hay clave real de Bright Data en este entorno, así que el
guardado se prueba contra el panel simulado y la restricción de la base, no contra el proveedor.
