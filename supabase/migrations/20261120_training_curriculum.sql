-- APLICADA en Supabase real (proyecto `closer-ia-ops`, ref `jzchuizybyubtkownhlw`) el 2026-11-20, por
-- orden expresa del propietario, como migración `training_curriculum` (versión 20261120071928); su prueba
-- `tests/db/training_curriculum.sql` pasó con BEGIN…ROLLBACK y el currículo quedó cargado (4/12/14/24).
-- Aditiva y reversible. Currículo de Formación importable desde Excel/CSV + progreso por lección, intentos
-- de test y estado de gamificación. Si la base no tiene currículo, la app sirve el versionado en el repo y
-- lo declara; el importador es idempotente por id.
--
-- Se reutilizan las tablas existentes: `student_activity` sigue siendo la señal de actividad que da XP,
-- rachas y logros (ADR-014: métricas derivadas, sin contadores que se puedan inflar), y las
-- candidaturas viven en `student_applications` (no se duplican en `job_applications`).
--
-- Todas las tablas son solo de servidor: RLS activado SIN políticas y sin grants para anon/authenticated.

create table if not exists public.training_modules (
  id text primary key,
  org_id text not null default 'cloud-wdc',
  position smallint not null check (position between 1 and 99),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 600),
  objectives jsonb not null default '[]'::jsonb check (jsonb_typeof(objectives) = 'array' and jsonb_array_length(objectives) between 1 and 8),
  deep_dive text,
  updated_at timestamptz not null default now()
);

create table if not exists public.training_lessons (
  id text primary key,
  org_id text not null default 'cloud-wdc',
  module_id text not null references public.training_modules(id) on delete cascade,
  position smallint not null check (position between 1 and 99),
  title text not null check (char_length(title) between 3 and 140),
  summary text not null check (char_length(summary) between 10 and 400),
  minutes smallint not null check (minutes between 1 and 120),
  content text not null check (char_length(content) between 40 and 4000),
  key_points jsonb not null default '[]'::jsonb check (jsonb_typeof(key_points) = 'array' and jsonb_array_length(key_points) between 1 and 6),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_resources (
  id text primary key,
  org_id text not null default 'cloud-wdc',
  lesson_id text not null references public.training_lessons(id) on delete cascade,
  type text not null check (type in ('template','script','checklist','link','doc','video')),
  title text not null check (char_length(title) between 3 and 140),
  description text not null check (char_length(description) between 5 and 300),
  url text,
  content text check (content is null or char_length(content) <= 4000),
  updated_at timestamptz not null default now(),
  check (url is not null or content is not null),
  check (type not in ('link','video') or url is not null)
);

create table if not exists public.training_questions (
  id text primary key,
  org_id text not null default 'cloud-wdc',
  lesson_id text not null references public.training_lessons(id) on delete cascade,
  position smallint not null check (position between 1 and 20),
  type text not null check (type in ('multiple','true_false','case')),
  prompt text not null check (char_length(prompt) between 10 and 500),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  correct smallint not null check (correct >= 0),
  explanation text not null check (char_length(explanation) between 20 and 800),
  updated_at timestamptz not null default now(),
  check (correct < jsonb_array_length(options))
);

-- Progreso por lección declarado por el servidor (la nota del test se calcula allí; el navegador no la fija).
create table if not exists public.user_lesson_progress (
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_id text not null references public.training_lessons(id) on delete cascade,
  quiz_score smallint check (quiz_score is null or quiz_score between 0 and 100),
  attempts smallint not null default 1 check (attempts between 1 and 999),
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, lesson_id)
);

create table if not exists public.user_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_id text not null references public.training_lessons(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  passed boolean not null default false,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.user_gamification_state (
  student_id uuid primary key references public.students(id) on delete cascade,
  org_id text not null default 'cloud-wdc',
  quote_seed text not null check (char_length(quote_seed) between 6 and 40),
  last_quote_day date,
  saved_quotes jsonb not null default '[]'::jsonb check (jsonb_typeof(saved_quotes) = 'array' and pg_column_size(saved_quotes) <= 2000),
  updated_at timestamptz not null default now()
);

create index if not exists training_modules_org_idx on public.training_modules (org_id, position);
create index if not exists training_lessons_module_idx on public.training_lessons (org_id, module_id, position);
create index if not exists training_resources_lesson_idx on public.training_resources (org_id, lesson_id);
create index if not exists training_questions_lesson_idx on public.training_questions (org_id, lesson_id, position);
create index if not exists user_quiz_attempts_student_idx on public.user_quiz_attempts (org_id, student_id, created_at desc);

alter table public.training_modules enable row level security;
alter table public.training_lessons enable row level security;
alter table public.training_resources enable row level security;
alter table public.training_questions enable row level security;
alter table public.user_lesson_progress enable row level security;
alter table public.user_quiz_attempts enable row level security;
alter table public.user_gamification_state enable row level security;

revoke all on public.training_modules, public.training_lessons, public.training_resources, public.training_questions,
  public.user_lesson_progress, public.user_quiz_attempts, public.user_gamification_state from anon, authenticated;
