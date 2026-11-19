-- Prueba de conducta con ROLLBACK para la tabla de criterios de práctica (no aplica DDL permanente).
-- Ejecutar en el SQL editor de Supabase (requiere confirmación del propietario) o en un Postgres con el esquema.
begin;

insert into public.practice_rubrics (org_id, rubrics, priorities, bant, updated_by)
values (
  'test-org',
  '{"venta":[{"id":"apertura","label":"Apertura y agenda","guide":"Agenda breve","weight":10}]}'::jsonb,
  '["No hubo pain cycle."]'::jsonb,
  '{"venta":true,"setter":true,"frio":true,"entrevista":false,"wdc-entrevista":false}'::jsonb,
  'test@example.com'
);

-- Upsert por organización: una segunda escritura reemplaza, no duplica.
insert into public.practice_rubrics (org_id, rubrics, priorities, bant, updated_by)
values (
  'test-org',
  '{"setter":[{"id":"cualificacion","label":"BANT y cualificación","guide":"Cuatro letras","weight":30}]}'::jsonb,
  '["No pidió la venta."]'::jsonb,
  '{"venta":true,"setter":true,"frio":true,"entrevista":false,"wdc-entrevista":false}'::jsonb,
  'test@example.com'
)
on conflict (org_id) do update set rubrics = excluded.rubrics, priorities = excluded.priorities;

do $$
declare rows_count int; label text;
begin
  select count(*) into rows_count from public.practice_rubrics where org_id = 'test-org';
  if rows_count <> 1 then raise exception 'esperaba 1 fila, hay %', rows_count; end if;
  select rubrics->'setter'->0->>'label' into label from public.practice_rubrics where org_id = 'test-org';
  if label <> 'BANT y cualificación' then raise exception 'el upsert no guardó el valor nuevo: %', label; end if;
end $$;

-- RLS activo y sin políticas: un rol anónimo no puede leer la configuración.
select relrowsecurity as rls_enabled from pg_class where oid = 'public.practice_rubrics'::regclass;

rollback;
