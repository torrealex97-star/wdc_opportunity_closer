-- Prueba de comportamiento de 20261121_source_route_order.sql. No deja datos: todo va dentro de una
-- transacción que termina en ROLLBACK. Uso: pegar el archivo completo en el SQL Editor de Supabase
-- (o MCP `execute_sql`).
begin;

-- 1) La columna existe con el contrato que lee `routeOrders()`: text[], NOT NULL, defecto '{}'.
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'source_settings' and column_name = 'route_order'
      and udt_name = '_text' and is_nullable = 'NO' and column_default like '''{}''%'
  ) then raise exception 'FALLO: falta source_settings.route_order text[] not null default ''{}'''; end if;
  if exists (select 1 from public.source_settings where route_order is null) then
    raise exception 'FALLO: hay filas con route_order NULL';
  end if;
end $$;

-- 2) Upsert como el del panel: guarda el orden sin reactivar una fuente pausada.
insert into public.source_settings (org_id, source, enabled, route_order, updated_by)
values ('test-org', 'infojobs', false, array['infojobs:official', 'infojobs:brightdata'], 'test@example.com');

update public.source_settings
  set route_order = array['infojobs:brightdata', 'infojobs:official'],
      updated_by = 'owner@test.dev', updated_at = now()
  where org_id = 'test-org' and source = 'infojobs';

do $$ declare ord text[]; en boolean; begin
  select route_order, enabled into ord, en
    from public.source_settings where org_id = 'test-org' and source = 'infojobs';
  if ord is distinct from array['infojobs:brightdata', 'infojobs:official'] then
    raise exception 'FALLO: el orden no se guardó: %', ord;
  end if;
  if en is distinct from false then
    raise exception 'FALLO: el upsert reactivó una fuente pausada';
  end if;
end $$;

-- 3) Vaciar el orden es volver al orden por coste, sin borrar la fila.
update public.source_settings set route_order = '{}' where org_id = 'test-org' and source = 'infojobs';

do $$ declare ord text[]; begin
  select route_order into ord from public.source_settings where org_id = 'test-org' and source = 'infojobs';
  if ord is distinct from '{}'::text[] then
    raise exception 'FALLO: no se pudo volver al orden por coste: %', ord;
  end if;
end $$;

-- 4) La PK (org_id, source) evita duplicados en el upsert que usa el panel.
do $$ declare n int; begin
  insert into public.source_settings (org_id, source, enabled, route_order, updated_by)
  values ('test-org', 'infojobs', true, '{}', 'test@example.com')
  on conflict (org_id, source) do update set updated_by = excluded.updated_by;
  select count(*) into n from public.source_settings where org_id = 'test-org' and source = 'infojobs';
  if n <> 1 then raise exception 'FALLO: la PK no evitó el duplicado (%)', n; end if;
end $$;

rollback;
