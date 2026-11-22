-- Prueba de comportamiento de 20261122_waterfall_settings.sql. No deja datos: todo va dentro de una
-- transacción que termina en ROLLBACK. Uso: pegar el archivo completo en el SQL Editor de Supabase
-- (o MCP `execute_sql`).
begin;

-- 1) La tabla existe, tiene PK en org_id, RLS y el navegador no la alcanza.
do $$ begin
  if to_regclass('public.waterfall_settings') is null then raise exception 'FALLO: falta la tabla waterfall_settings'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('public.waterfall_settings')) then
    raise exception 'FALLO: RLS desactivado en waterfall_settings';
  end if;
  if has_table_privilege('anon', 'public.waterfall_settings', 'select')
     or has_table_privilege('authenticated', 'public.waterfall_settings', 'select')
     or has_table_privilege('authenticated', 'public.waterfall_settings', 'insert')
     or has_table_privilege('anon', 'public.waterfall_settings', 'update') then
    raise exception 'FALLO: anon/authenticated conservan privilegios sobre waterfall_settings';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.waterfall_settings') and c.contype = 'p'
      and pg_get_constraintdef(c.oid) like '%(org_id)%'
  ) then raise exception 'FALLO: falta la PK (org_id)'; end if;
end $$;

-- 2) Sin semilla: sin fila no hay objetivo guardado (la app cae al entorno y lo declara).
do $$ declare n int; begin
  select count(*) into n from public.waterfall_settings where org_id = 'cloud-wdc';
  if n <> 0 then raise exception 'FALLO: la tabla no debe traer una fila sembrada para cloud-wdc (hay %)', n; end if;
end $$;

-- 3) Upsert por org_id: cambia el objetivo sin duplicar y guarda quién lo cambió.
insert into public.waterfall_settings (org_id, qualified_per_day, updated_by) values ('test-org', 40, 'test@example.com');
insert into public.waterfall_settings (org_id, qualified_per_day, updated_by) values ('test-org', 60, 'owner@test.dev')
on conflict (org_id) do update set qualified_per_day = excluded.qualified_per_day, updated_by = excluded.updated_by, updated_at = now();

do $$ declare n int; q int; editor text; begin
  select count(*), min(qualified_per_day), min(updated_by) into n, q, editor from public.waterfall_settings where org_id = 'test-org';
  if n <> 1 then raise exception 'FALLO: el upsert duplicó la fila (%)', n; end if;
  if q <> 60 or editor <> 'owner@test.dev' then raise exception 'FALLO: el upsert no actualizó objetivo y autor (%, %)', q, editor; end if;
end $$;

-- 4) Los límites del CHECK: 0 vale («no se gasta»), lo negativo y lo desmedido no.
insert into public.waterfall_settings (org_id, qualified_per_day, updated_by) values ('test-cero', 0, 'owner@test.dev');
do $$ begin
  begin
    insert into public.waterfall_settings (org_id, qualified_per_day, updated_by) values ('test-neg', -1, 'x');
    raise exception 'FALLO: aceptó un objetivo negativo';
  exception when check_violation then null; end;
  begin
    insert into public.waterfall_settings (org_id, qualified_per_day, updated_by) values ('test-alto', 10001, 'x');
    raise exception 'FALLO: aceptó un objetivo por encima de 10.000';
  exception when check_violation then null; end;
  begin
    insert into public.waterfall_settings (org_id, qualified_per_day, updated_by) values ('test-nulo', null, 'x');
    raise exception 'FALLO: aceptó un objetivo nulo';
  exception when not_null_violation then null; end;
end $$;

rollback;
select 'OK: waterfall_settings (tabla, RLS, privilegios, upsert y límites)' as resultado;
