-- NO APLICADA en Supabase (aplicar DDL exige orden expresa del propietario). Aditiva y reversible (drop table).
-- Retos asignados por la coordinadora: un escenario del catálogo, una nota mínima opcional, una fecha límite
-- y una nota escrita por ella. NO se guarda el estado: se deriva de `student_activity` (una práctica del mismo
-- escenario, dentro del plazo y con la nota mínima). Así el reto no puede «marcarse hecho» desde el navegador.
-- Solo el servidor (service role) lee y escribe; RLS activado SIN políticas, igual que `students` y `student_activity`.
create table if not exists public.student_challenges (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  student_id uuid not null references public.students(id) on delete cascade,
  -- Id de una situación de la sala de práctica. El catálogo se valida en el servidor; la BD solo acota la forma.
  scenario_id text not null check (scenario_id ~ '^[a-z0-9_-]{1,60}$'),
  -- Nota mínima opcional: null = cualquier práctica puntuada del escenario cumple. 0 no se usa (sería un umbral falso).
  min_score smallint check (min_score is null or min_score between 1 and 100),
  due_on date not null,
  coach_note text not null check (char_length(btrim(coach_note)) between 1 and 500),
  created_by text check (created_by is null or char_length(created_by) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists student_challenges_student_idx on public.student_challenges (org_id, student_id, due_on desc);
create index if not exists student_challenges_due_idx on public.student_challenges (org_id, due_on);
alter table public.student_challenges enable row level security;
revoke all on public.student_challenges from anon, authenticated;
