-- Prueba de comportamiento de 20261121_provider_budget.sql. No deja datos: todo va dentro de una
-- transacción que termina en ROLLBACK. Uso: pegar el archivo completo en el SQL Editor de Supabase
-- (o MCP `execute_sql`).
begin;

-- 1) La tabla existe, tiene PK (org_id, provider), RLS y el navegador no la alcanza.
do $$ begin
  if to_regclass('public.provider_budget') is null then raise exception 'FALLO: falta la tabla provider_budget'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('public.provider_budget')) then
    raise exception 'FALLO: RLS desactivado en provider_budget';
  end if;
  if has_table_privilege('anon', 'public.provider_budget', 'select')
     or has_table_privilege('authenticated', 'public.provider_budget', 'select')
     or has_table_privilege('authenticated', 'public.provider_budget', 'insert') then
    raise exception 'FALLO: anon/authenticated conservan privilegios sobre provider_budget';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.provider_budget') and c.contype = 'p'
      and pg_get_constraintdef(c.oid) like '%(org_id, provider)%'
  ) then raise exception 'FALLO: falta la PK (org_id, provider)'; end if;
end $$;

-- 2) La semilla deja los cinco proveedores de la organización del producto a 5 USD (JSearch incluido).
do $$ declare n int; begin
  select count(*) into n from public.provider_budget where org_id = 'cloud-wdc' and monthly_usd = 5;
  if n <> 5 then raise exception 'FALLO: la semilla no dejó 5 proveedores a 5 USD (hay %)', n; end if;
end $$;

-- 3) Upsert por (org_id, provider): cambia el tope sin duplicar y guarda quién lo cambió.
insert into public.provider_budget (org_id, provider, monthly_usd, updated_by)
values ('test-org', 'brightdata', 7.50, 'test@example.com');

insert into public.provider_budget (org_id, provider, monthly_usd, updated_by)
values ('test-org', 'brightdata', 9.00, 'owner@test.dev')
on conflict (org_id, provider) do update
  set monthly_usd = excluded.monthly_usd, updated_by = excluded.updated_by, updated_at = now();

do $$ declare n int; usd numeric; editor text; begin
  select count(*), min(monthly_usd), min(updated_by) into n, usd, editor
    from public.provider_budget where org_id = 'test-org';
  if n <> 1 then raise exception 'FALLO: el upsert duplicó filas (%)', n; end if;
  if usd <> 9.00 then raise exception 'FALLO: el upsert no guardó 9.00, hay %', usd; end if;
  if editor <> 'owner@test.dev' then raise exception 'FALLO: no se guardó quién cambió el tope: %', editor; end if;
end $$;

-- 4) Se rechazan proveedores fuera de la lista y topes imposibles.
do $$ begin
  begin
    insert into public.provider_budget (org_id, provider, monthly_usd) values ('test-org', 'apify', 5);
    raise exception 'FALLO: aceptó apify (tiene paid_budget propio)';
  exception when check_violation then null; end;
  begin
    insert into public.provider_budget (org_id, provider, monthly_usd) values ('test-org', 'serpapi', -1);
    raise exception 'FALLO: aceptó un tope negativo';
  exception when check_violation then null; end;
  begin
    insert into public.provider_budget (org_id, provider, monthly_usd) values ('test-org', 'serpapi', 5000.01);
    raise exception 'FALLO: aceptó un tope de más de 5000 USD';
  exception when check_violation then null; end;
end $$;

rollback;
