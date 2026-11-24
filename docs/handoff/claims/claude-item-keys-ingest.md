---
agent: claude
status: in_progress
branch: claude/item-keys-ingest
touches: apps/web/lib/apify.ts, apps/web/lib/external.ts, tests/admin-auth/ingest.mjs, tests/admin-auth/apify-inputs.mjs, docs/STATUS.md
date: 2026-11-24
---
Corrige #175: `raw.item_keys` se perdía en `classify` (solo pasan valores simples). Ahora llega a la base como texto acotado, para diagnosticar
por qué Elempleo y Talent llegan sin descripción.
