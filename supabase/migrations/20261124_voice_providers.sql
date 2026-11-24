-- Voz: claves de ElevenLabs y Deepgram (la de OpenAI ya existe) y registro de incidencias de proveedor para la cascada
-- (usa el más barato con clave y, si falla por pago, clave o errores, sigue con el siguiente). Aditiva y reversible.
-- NO guarda audio ni texto: solo el tipo de incidencia, el proveedor y una nota corta. Solo la clave de servicio accede.
-- Prueba: tests/db/voice_providers.sql (BEGIN…ROLLBACK).
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('apify', 'serpapi', 'groq', 'openai', 'adzuna', 'jooble', 'infojobs', 'resend', 'brightdata', 'zenrows', 'scrapingbee', 'jsearch', 'rapidapi', 'tavily', 'elevenlabs', 'deepgram'));

create table if not exists public.voice_provider_events (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  provider text not null check (provider in ('openai_realtime_mini', 'deepgram_agent', 'openai_realtime', 'elevenlabs_agents')),
  kind text not null check (kind in ('ok', 'error', 'payment', 'auth')),
  detail text check (detail is null or length(detail) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists voice_provider_events_org_time_idx on public.voice_provider_events (org_id, created_at desc);
alter table public.voice_provider_events enable row level security;
revoke all on public.voice_provider_events from anon, authenticated;
