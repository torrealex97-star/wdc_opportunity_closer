-- Versionado e historial de los criterios de práctica.
-- PREPARADA Y SIN APLICAR: aplicarla en Supabase exige orden expresa del propietario.
-- El backend local de desarrollo la refleja en `apps/web/lib/practiceLocalMigrations.ts`.
alter table public.practice_rubrics
  add column if not exists version integer not null default 0 check (version >= 0),
  add column if not exists history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array');
