-- Prueba de comportamiento del límite de gasto en medios de pago (`paid_budget`).
-- No deja datos: todo ocurre dentro de una transacción que termina en ROLLBACK.
-- Uso: aplicar la migración y ejecutar el archivo completo contra la base (MCP `execute_sql` o psql).
begin;

-- 1) La tabla existe, con RLS y sin acceso desde el navegador (solo la clave de servicio).
do $$
begin
  if to_regclass('public.paid_budget') is null then
    raise exception 'falta la tabla paid_budget';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.paid_budget'::regclass) then
    raise exception 'RLS desactivado en paid_budget';
  end if;
  if has_table_privilege('anon', 'public.paid_budget', 'select')
     or has_table_privilege('authenticated', 'public.paid_budget', 'select')
     or has_table_privilege('anon', 'public.paid_budget', 'insert')
     or has_table_privilege('authenticated', 'public.paid_budget', 'update') then
    raise exception 'anon/authenticated conservan privilegios sobre paid_budget';
  end if;
  if not has_table_privilege('service_role', 'public.paid_budget', 'select')
     or not has_table_privilege('service_role', 'public.paid_budget', 'insert')
     or not has_table_privilege('service_role', 'public.paid_budget', 'update') then
    raise exception 'la clave de servicio no puede leer ni guardar el límite';
  end if;
end $$;

-- 2) Un límite por organización con el valor por defecto de la app.
insert into public.paid_budget (monthly_usd, updated_by) values (10, 'operador-prueba');
do $$
begin
  if (select org_id from public.paid_budget where updated_by = 'operador-prueba') <> 'cloud-wdc' then
    raise exception 'la organización por defecto no es cloud-wdc';
  end if;
  if (select updated_at from public.paid_budget where updated_by = 'operador-prueba') is null then
    raise exception 'no se registró cuándo se cambió el límite';
  end if;
end $$;

-- 3) El panel guarda con upsert por organización: cambiar el límite no duplica la fila.
insert into public.paid_budget (org_id, monthly_usd, updated_by)
values ('cloud-wdc', 25.50, 'operador-prueba')
on conflict (org_id) do update
  set monthly_usd = excluded.monthly_usd, updated_by = excluded.updated_by, updated_at = now();
do $$
begin
  if (select count(*) from public.paid_budget where org_id = 'cloud-wdc') <> 1 then
    raise exception 'el upsert duplicó la fila del límite';
  end if;
  if (select monthly_usd from public.paid_budget where org_id = 'cloud-wdc') <> 25.50 then
    raise exception 'el upsert no guardó el importe nuevo';
  end if;
end $$;

-- 4) Se rechaza lo que el formulario rechaza: fuera de rango y sin autor.
do $$
begin
  begin
    insert into public.paid_budget (org_id, monthly_usd, updated_by) values ('otra-org', 0.50, 'operador-prueba');
    raise exception 'aceptó un límite por debajo de 1 USD';
  exception when check_violation then null;
  end;
  begin
    insert into public.paid_budget (org_id, monthly_usd, updated_by) values ('otra-org', 5001, 'operador-prueba');
    raise exception 'aceptó un límite por encima de 5000 USD';
  exception when check_violation then null;
  end;
  begin
    insert into public.paid_budget (org_id, monthly_usd, updated_by) values ('otra-org', 10, 'ab');
    raise exception 'aceptó un autor de dos caracteres';
  exception when check_violation then null;
  end;
end $$;

rollback;
