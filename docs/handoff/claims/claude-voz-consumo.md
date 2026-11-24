---
agent: claude
status: validated
branch: claude/voz-consumo
pr: 0
depends_on: claude-voz-fase-b
touches: apps/web/lib/voiceUsage.ts, apps/web/app/api/voice/usage/route.ts, apps/web/app/api/admin/voice-limits/route.ts, apps/web/app/api/student/voice/route.ts, apps/web/components/VoiceLimits.tsx, supabase/migrations/20261124_voice_usage.sql, tests/db/voice_usage.sql, tests/admin-auth/voiceusage.mjs, tests/admin-auth/run.sh, docs/STATUS.md, docs/REFERENCIAS_SCRAPERS.md
date: 2026-11-24
---
Consumo real de la voz: tabla voice_usage (aplicada), lectura y anotación acotadas a 10 min/día, ruta del servicio de voz con token y panel con datos reales.
