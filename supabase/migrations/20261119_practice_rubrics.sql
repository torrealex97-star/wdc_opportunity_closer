-- NO APLICADA en Supabase (aplicar DDL exige orden expresa del propietario). Aditiva y reversible (drop table).
-- Criterios editables de la sala de práctica y del análisis de llamadas. Una fila por organización:
-- rúbricas por sala (ids, etiquetas, guías y pesos), orden de prioridades de corrección y qué salas
-- exigen auditoría BANT. Los valores por defecto viven en `apps/web/lib/practiceRubrics.ts`; esta tabla
-- solo guarda lo que el panel cambia. El servidor valida el JSON entero antes de escribir.
create table if not exists public.practice_rubrics (
  org_id text primary key,
  rubrics jsonb not null check (jsonb_typeof(rubrics) = 'object'),
  priorities jsonb not null default '[]'::jsonb check (jsonb_typeof(priorities) = 'array'),
  bant jsonb not null default '{}'::jsonb check (jsonb_typeof(bant) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or char_length(updated_by) <= 200)
);
-- Solo el servidor (service role) lee y escribe; RLS activado SIN políticas, igual que `students`.
alter table public.practice_rubrics enable row level security;
revoke all on public.practice_rubrics from anon, authenticated;
