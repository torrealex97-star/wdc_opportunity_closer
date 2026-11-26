---
agent: claude
status: in_progress
branch: claude/formulario-empleadores
touches: apps/web/lib/employerOffer.ts, apps/web/lib/employerStore.ts, apps/web/app/api/employers, apps/web/app/empleadores, apps/web/components/EmployerForm.tsx, apps/web/lib/legal.ts, apps/web/lib/sourceControlData.ts, supabase/migrations/20261126_employer_submissions.sql, tests/db/employer_submissions.sql, tests/admin-auth/employer.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/flow.mjs, tests/admin-auth/ui.mjs, tests/admin-auth/run.sh, docs/STATUS.md
date: 2026-11-26
---
Formulario público para que empresas publiquen ofertas de closer/setter/cold calling: entra como borrador (source=empleadores, via=employer-form) y lo clasifican la revisión automática y la humana; nunca se publica solo. Contacto de la empresa aparte de lo que ve la alumna; honeypot, límites y una oferta por enlace.
