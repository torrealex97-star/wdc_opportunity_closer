-- Modo del revisor IA («shadow» anota sin aplicar; «live» aplica sus decisiones) editable desde el panel.
-- Una fila por organización. Sin fila: manda la variable de entorno AI_REVIEW_MODE y, si tampoco está, `shadow`.
-- Solo el propietario lo cambia desde la app (ruta /api/admin/ai-mode); cada cambio guarda quién y cuándo.
-- Aditiva: no toca filas ni activa nada por sí sola (sin fila, el modo sigue como estaba).
-- Prueba: `tests/db/ai_review_settings.sql` (BEGIN…ROLLBACK). Reversión: `drop table if exists public.ai_review_settings;`.
-- NO aplicada a la base real: requiere orden expresa del propietario (AGENTS.md).
create table if not exists public.ai_review_settings (
  org_id text primary key default 'cloud-wdc',
  mode text not null check (mode in ('shadow', 'live')),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

comment on table public.ai_review_settings is
  'Modo del revisor IA por organización (shadow o live). Sin fila: variable de entorno AI_REVIEW_MODE, y si no, shadow.';

alter table public.ai_review_settings enable row level security;
revoke all on public.ai_review_settings from anon, authenticated;
