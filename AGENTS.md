# Career Platform

Read docs/PLAN.md, docs/STATUS.md and docs/spec/15_PRODUCT_VISION_AND_BOUNDARIES.md before work.
This repository is independent of Scalix. Never use its secrets, database or deployment.
Deliver one bounded, tested increment at a time. Read the relevant original spec and ADR before changing contracts.
Keep raw evidence immutable and separate from processing state. Connectors return raw candidates, never write jobs.
Always scope data access by organization; local single-operator mode is not hosted authentication.
No invented listings, salaries, dates or eligibility. Expose unknowns. A failed source must not hide successful results.
OpenAPI generates frontend types. Keep providers replaceable and paid integrations opt-in.
Run backend tests, web typecheck/build and relevant browser checks. Record evidence and limitations in docs/STATUS.md.
Do not deploy local mode publicly. Do not send messages or applications automatically without explicit configuration and authorization.

Architecture revision: docs/decisions/ADR-007-groq-opportunity-surfaces.md and docs/spec/16_LLM_PROVIDER_GROQ.md define Groq as the target default behind LLMProvider. Current runtime status remains in STATUS. Student WDCOpportunity is a separate allowlisted projection; never remove admin provenance or infer a direct WDC relationship from a public company URL. Documentation-only changes require link/consistency verification; do not claim runtime tests were run.

## Learned rules (adopted 2026-10-17; rationale in docs/LEARNINGS_GROWTH_OPS.md)

- Cron/serverless budgets: the sum of internal deadlines stays far below `maxDuration`. One shared clock per invocation; every external call checks it; a cut is declared (`truncated`) and the work is idempotent and resumable.
- Irreversible external effects (sending, publishing, deleting): atomic claim first (`UPDATE … WHERE status='draft'`, continue only if the row is yours). Always consume the result of every write (`ok`/`error`); a failed write is never counted as done.
- Paid scraping (Apify): estimate cost before running (per-result price × count); warn above 5 USD, require explicit confirmation above 20 USD; read the actor's input schema instead of guessing it.
- Every migration: behaviour test with `BEGIN … ROLLBACK` (saved under `tests/db/`) and Supabase advisors afterwards; version the SQL in `supabase/migrations/` in the same PR that applies it.
- Student data: never send student profile data to an LLM without a processing agreement and zero retention. Matching stays deterministic.
- Evidence wording in STATUS and PRs: *inspected* (read), *tested* (executed in a controlled or simulated environment), *verified* (confirmed against the real service). Never claim a higher level than was reached.
- Paid coverage (Apify catalog): a source gets a search engine only when a store actor is validated from public metadata (exists, not deprecated, build `SUCCEEDED`, input schema read). Never invent one. A source without a compatible actor keeps "sin proveedor verificado" and its blocking —queries, totals, rejected actors— stays recorded in `source_audit.json`. An actor whose contract is not the source's is excluded with a written reason.
- Paid budget allocation: rank routes by **approved offers per dollar**, not by harvested items, with numerator and cost from the same window. A missing count is not zero: the route goes last and the panel says why.
- Generated artefacts: emit them in the shape the app consumes (typed module, same fields), not a JSON the app translates at runtime. One place per string.
- Two Next processes on the same `.next` corrupt Turbopack's cache (`Failed to open database … invalid digit found in string`). Check for a live `next dev` before building; `next build --webpack` uses a separate cache; never delete `.next` under another session.
- Shared documents: when another agent has uncommitted work in the same file (`STATUS`, `AGENTS`), commit `HEAD` + your own hunks and put their block back in the tree afterwards; never `git add` the whole file.

## Design and charts

- Before creating or changing any dashboard, KPI, chart, table or empty state in `apps/web`, read `.agents/skills/dashboard-design/SKILL.md` (and `docs/DESIGN.md`); theory in `data-visualization-pro`. Student-facing pages (`/alumna`, opportunities view) use `design-taste-frontend` within `docs/DESIGN.md`. No hex colors outside the tokens in `globals.css` (`npm run design`).
- A gap is not a zero: unknown / failed / unconfigured / empty are shown differently ("—" plus the cause). Color is never the only encoding. Every non-trivial chart has a text or table alternative.

## Sales method and call review

- `metodo-wdc` is the WDC academy method **and the map of its Classroom** (`.agents/skills/metodo-wdc/SKILL.md`): §0 has the 12 modules, the 130 lessons and where each topic is taught, so answer "where is this taught?" from it instead of guessing. It is training material, not this product's sales system.
- Scoring a real call: `analisis-llamadas-ventas` (rubric). `scalix-ventas` is a different sales system for a different company: keep its figures and scripts out of this repo's product and docs.

## Working with several agents

- Read `docs/ACTIVE_HANDOFF.md` and run `node scripts/handoff.mjs list` before starting. One claim file per live job in `docs/handoff/claims/`; do not touch what another claim lists in `touches`. `npm run handoff` must pass. Rules and template: `docs/handoff/README.md`.
- **Nothing orphaned (rule from the 2026-10-24 red-`main` incident):** never push tests, mocks, STATUS entries or docs for code that is not in the same branch, and never close a session with unpushed work (`git status` clean, branch pushed). `tests/orphan-refs.mjs` (run by `run.sh`, so by CI) fails when a test calls an `/api` route or invokes a test file that does not exist.
- One `in_progress` job per agent; stacked branches declare `depends_on`. Never delete or replace another agent's unmerged work. Without a merge-base there is no merge.
- At the end of a session leave either: validated (pushed, PR open, claim `validated`) or blocked (pushed, claim `blocked` with the exact next action). Do not merge dubious code just to close a session.
- **Merging (standing owner authorization, 2026-10-18):** an agent may merge its own PRs when ALL hold: `verify` and `web-admin` are green on the current head; no merge conflict; no open red-circle review finding; a plain merge commit (no squash, no rebase, no force-push); the closed claim file is removed afterwards. A known flaky job is re-run ONCE; a test is never skipped or disabled to get green. **Still requires the owner's explicit order:** applying migrations/DDL to the real Supabase or changing secrets/env; enabling `STUDENT_LOGIN_REQUIRED` or moving the AI reviewer to `live`; any application automation (Phase 4, ADR-012); new paid spend.

