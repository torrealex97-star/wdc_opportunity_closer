-- Prueba de conducta con ROLLBACK para la tabla de criterios de práctica (no aplica DDL permanente).
-- Ejecutar en el SQL editor de Supabase (requiere confirmación del propietario) o en un Postgres con el esquema.
begin;

insert into public.practice_rubrics (org_id, rubrics, priorities, bant, updated_by, version, history)
values (
  'test-org',
  '{"venta":[{"id":"apertura","label":"Apertura y agenda","guide":"Agenda breve","weight":10}]}'::jsonb,
  '["No hubo pain cycle."]'::jsonb,
  '{"venta":true,"setter":true,"frio":true,"entrevista":false,"llamada":true}'::jsonb,
  'test@example.com',
  1,
  '[{"version":1,"by":"test@example.com","config":{}}]'::jsonb
);

-- Upsert por organización: una segunda escritura reemplaza, no duplica.
insert into public.practice_rubrics (org_id, rubrics, priorities, bant, updated_by, version, history)
values (
  'test-org',
  '{"setter":[{"id":"cualificacion","label":"BANT y cualificación","guide":"Cuatro letras","weight":30}]}'::jsonb,
  '["No pidió la venta."]'::jsonb,
  '{"venta":true,"setter":true,"frio":true,"entrevista":false,"llamada":true}'::jsonb,
  'test@example.com',
  2,
  '[{"version":1,"by":"test@example.com","config":{}},{"version":2,"by":"test@example.com","config":{}}]'::jsonb
)
on conflict (org_id) do update set rubrics = excluded.rubrics, priorities = excluded.priorities,
  version = excluded.version, history = excluded.history;

do $$
declare rows_count int; label text; version_saved int; history_len int;
begin
  select count(*) into rows_count from public.practice_rubrics where org_id = 'test-org';
  if rows_count <> 1 then raise exception 'esperaba 1 fila, hay %', rows_count; end if;
  select rubrics->'setter'->0->>'label', version, jsonb_array_length(history)
    into label, version_saved, history_len
    from public.practice_rubrics where org_id = 'test-org';
  if label <> 'BANT y cualificación' then raise exception 'el upsert no guardó el valor nuevo: %', label; end if;
  if version_saved <> 2 then raise exception 'esperaba versión 2, hay %', version_saved; end if;
  if history_len <> 2 then raise exception 'esperaba 2 versiones, hay %', history_len; end if;
end $$;

-- RLS activo y sin políticas: un rol anónimo no puede leer la configuración.
select relrowsecurity as rls_enabled from pg_class where oid = 'public.practice_rubrics'::regclass;

rollback;
