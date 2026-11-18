-- Control del gasto en medios de pago: UN límite mensual por organización, que el propietario cambia desde
-- el panel (pestaña Apify) sin tocar variables de entorno ni desplegar. De ese límite sale el reparto: cada
-- búsqueda de pago se topa a su parte y, cuando no queda, se aplaza y se dice por qué (nunca se gasta de más
-- ni se calla). La app ya lo usa en cuanto la tabla existe; sin ella cae al valor del entorno y el panel lo
-- declara (no finge que el control está activo).
-- Historial: no guarda claves ni datos de alumnas, solo el importe y quién/cuándo lo cambió.
-- Seguridad: solo la clave de servicio (RLS sin políticas, sin privilegios para anon/authenticated).
-- Reversión: `drop table if exists public.paid_budget;` (la app vuelve al valor del entorno).
create table if not exists public.paid_budget (
  org_id text primary key default 'cloud-wdc',
  monthly_usd numeric(10,2) not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  constraint paid_budget_monthly_usd_check check (monthly_usd >= 1 and monthly_usd <= 5000),
  constraint paid_budget_updated_by_check check (char_length(updated_by) between 3 and 254)
);

alter table public.paid_budget enable row level security;
revoke all on public.paid_budget from anon, authenticated;
