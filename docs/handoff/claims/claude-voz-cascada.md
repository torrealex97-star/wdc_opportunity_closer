---
agent: claude
status: in_progress
branch: claude/voz-cascada
pr: 0
depends_on: claude-voz-fase-b
touches: apps/web/app/api/voice/usage/route.ts, apps/web/app/api/student/voice/route.ts, supabase/migrations/20261124_voice_usage.sql, tests/db/voice_usage.sql, docs/REFERENCIAS_SCRAPERS.md, apps/web/lib/voiceCascade.ts, apps/web/lib/voiceEvents.ts, apps/web/lib/voiceWorker.ts, apps/web/lib/voiceUsage.ts, apps/web/lib/integrations.ts, apps/web/app/api/voice/provider/route.ts, apps/web/app/api/voice/provider-event/route.ts, apps/web/app/api/admin/voice-limits/route.ts, apps/web/components/VoicePanel.tsx, apps/web/components/AdminShell.tsx, apps/web/components/ApisTab.tsx, supabase/migrations/20261124_voice_providers.sql, tests/db/voice_providers.sql, tests/admin-auth/voicecascade.mjs, tests/admin-auth/voiceworker.mjs, tests/admin-auth/voiceusage.mjs, tests/admin-auth/flow.mjs, tests/admin-auth/ui.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/run.sh, docs/STATUS.md
date: 2026-11-24
---
Consumo real de voz (tabla aplicada) y sección de Voz propia en el admin y cascada de proveedores por coste (el más barato con clave y sano; salta por pago, clave o errores), con claves de ElevenLabs y Deepgram en APIs.
