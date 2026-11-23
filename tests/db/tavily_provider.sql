-- Prueba de comportamiento de 20261122_tavily_provider.sql. Se ejecuta en una transacción que se deshace.
begin;
\i supabase/migrations/20261122_tavily_provider.sql

-- 1) La conexión de Tavily se puede guardar.
insert into public.integration_connections (provider, secret_ciphertext, last4, updated_by)
values ('tavily', 'cifrado-de-prueba', 'abcd', 'test@example.com');

-- 2) Su tope mensual se puede fijar por organización.
insert into public.provider_budget (org_id, provider, monthly_usd, updated_by)
values ('cloud-wdc', 'tavily', 3, 'test@example.com')
on conflict (org_id, provider) do update set monthly_usd = excluded.monthly_usd, updated_by = excluded.updated_by;

-- 3) Los proveedores existentes siguen valiendo y uno inventado sigue rechazado.
do $$
begin
  begin
    insert into public.provider_budget (org_id, provider, monthly_usd, updated_by) values ('cloud-wdc', 'inventado', 1, 'x');
    raise exception 'debía rechazar un proveedor que no existe';
  exception when check_violation then null;
  end;
  begin
    insert into public.integration_connections (provider, secret_ciphertext, last4, updated_by) values ('inventado', 'x', 'x', 'x');
    raise exception 'debía rechazar una conexión que no existe';
  exception when check_violation then null;
  end;
end $$;

select provider, monthly_usd from public.provider_budget where provider = 'tavily';
rollback;
