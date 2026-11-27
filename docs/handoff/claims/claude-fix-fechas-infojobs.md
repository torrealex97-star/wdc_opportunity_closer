---
agent: claude
status: in_progress
branch: claude/fix-fechas-infojobs
touches: tests/admin-auth/infojobs.mjs, docs/STATUS.md
date: 2026-11-27
---
El test de InfoJobs usaba fechas absolutas y se rompió solo el 2026-11-27 a las 09:00 UTC al cumplir 10 días la oferta de setter. Fechas relativas al reloj; no cambia código de producción.
