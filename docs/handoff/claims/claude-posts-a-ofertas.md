---
agent: claude
status: in_progress
branch: claude/posts-a-ofertas
touches: apps/web/lib/socialPosts.ts, apps/web/lib/apify.ts, apps/web/lib/external.ts, tests/admin-auth/apify-inputs.mjs, tests/admin-auth/ingest.mjs, docs/STATUS.md
date: 2026-11-26
---
Las publicaciones de Facebook, Telegram, Skool y Reddit no traen título de puesto y `mapItem` las descartaba (Reddit: 50 elementos, 0 guardados). Se convierten en oferta solo si ofrecen trabajo de ventas; `kind` y `author` llegan a la base.
