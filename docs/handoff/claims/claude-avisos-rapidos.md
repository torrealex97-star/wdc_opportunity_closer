---
agent: claude
status: in_progress
branch: claude/avisos-rapidos
touches: apps/web/lib/studentAlerts.ts, apps/web/lib/studentAlertsStore.ts, apps/web/lib/legal.ts, apps/web/app/api/student/alerts, apps/web/app/api/alerts, apps/web/app/api/cron/alerts, apps/web/app/api/admin/student-alerts, apps/web/components/StudentAlerts.tsx, apps/web/components/AlertsPanel.tsx, apps/web/components/StudentPortal.tsx, apps/web/components/StudentsTab.tsx, apps/web/vercel.json, supabase/migrations/20261127_student_alerts.sql, tests/db/student_alerts.sql, tests/admin-auth/alerts.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/flow.mjs, tests/admin-auth/ui.mjs, tests/admin-auth/run.sh, docs/STATUS.md
date: 2026-11-27
---
Avisos rápidos por email a las alumnas con consentimiento aparte: emparejamiento determinista, cola con reclamo atómico, envío por Resend, baja firmada. Apagado por defecto (STUDENT_ALERTS_ENABLED); activarlo y la clave de Resend son del propietario. Sin envío real verificado.
