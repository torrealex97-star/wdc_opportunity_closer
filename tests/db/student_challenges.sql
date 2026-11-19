-- Prueba de comportamiento de `student_challenges` (migración 20261119_student_challenges.sql, NO aplicada todavía).
-- Todo ocurre dentro de una transacción que termina en ROLLBACK: no deja alumnas, retos ni cambios.
-- Uso: ejecutar el archivo completo contra la base (MCP `execute_sql` o psql) DESPUÉS de aplicar la migración.
begin;

-- 1) La tabla existe, tiene RLS y el navegador no puede leerla ni escribirla.
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.student_challenges'::regclass) then
    raise exception 'FALLO: falta la tabla student_challenges';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.student_challenges'::regclass) then
    raise exception 'FALLO: RLS desactivado en student_challenges';
  end if;
  if has_table_privilege('anon', 'public.student_challenges', 'select')
     or has_table_privilege('authenticated', 'public.student_challenges', 'select')
     or has_table_privilege('anon', 'public.student_challenges', 'insert') then
    raise exception 'FALLO: anon/authenticated conservan privilegios sobre student_challenges';
  end if;
end $$;

-- 2) Una alumna de prueba y un reto válido (con y sin nota mínima). La fecha límite es obligatoria.
insert into public.students (org_id, email, status, invited_by)
values ('cloud-wdc', 'prueba-retos@example.test', 'active', 'test');

insert into public.student_challenges (org_id, student_id, scenario_id, min_score, due_on, coach_note, created_by)
select 'cloud-wdc', s.id, v.scenario_id, v.min_score, v.due_on::date, v.coach_note, 'coach@test.dev'
from public.students s,
  (values
    ('objeciones-precio', 70, '2026-12-01', 'Trabaja el «me parece caro» sin rebajar.'),
    ('entrevista-closer', null, '2026-12-05', 'Cuenta un caso con cifras.')
  ) as v(scenario_id, min_score, due_on, coach_note)
where s.email = 'prueba-retos@example.test';

do $$
begin
  if (select count(*) from public.student_challenges c join public.students s on s.id = c.student_id
      where s.email = 'prueba-retos@example.test') <> 2 then
    raise exception 'FALLO: no se guardaron los dos retos válidos';
  end if;
end $$;

-- 3) Se rechazan: escenario con forma inválida, nota mínima 0 o 101, fecha nula, nota vacía o de más de 500,
--    y una alumna que no existe.
do $$
declare sid uuid;
begin
  select id into sid from public.students where email = 'prueba-retos@example.test';
  begin
    insert into public.student_challenges (student_id, scenario_id, due_on, coach_note) values (sid, 'Escenario con espacios', '2026-12-01', 'nota');
    raise exception 'FALLO: aceptó un scenario_id inválido';
  exception when check_violation then null;
  end;
  begin
    insert into public.student_challenges (student_id, scenario_id, min_score, due_on, coach_note) values (sid, 'venta-fria', 0, '2026-12-01', 'nota');
    raise exception 'FALLO: aceptó min_score 0';
  exception when check_violation then null;
  end;
  begin
    insert into public.student_challenges (student_id, scenario_id, min_score, due_on, coach_note) values (sid, 'venta-fria', 101, '2026-12-01', 'nota');
    raise exception 'FALLO: aceptó min_score 101';
  exception when check_violation then null;
  end;
  begin
    insert into public.student_challenges (student_id, scenario_id, coach_note) values (sid, 'venta-fria', 'nota');
    raise exception 'FALLO: aceptó un reto sin fecha límite';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.student_challenges (student_id, scenario_id, due_on, coach_note) values (sid, 'venta-fria', '2026-12-01', '   ');
    raise exception 'FALLO: aceptó una nota del coach vacía';
  exception when check_violation then null;
  end;
  begin
    insert into public.student_challenges (student_id, scenario_id, due_on, coach_note) values (sid, 'venta-fria', '2026-12-01', repeat('a', 501));
    raise exception 'FALLO: aceptó una nota de más de 500 caracteres';
  exception when check_violation then null;
  end;
  begin
    insert into public.student_challenges (student_id, scenario_id, due_on, coach_note) values (gen_random_uuid(), 'venta-fria', '2026-12-01', 'nota');
    raise exception 'FALLO: aceptó una alumna inexistente';
  exception when foreign_key_violation then null;
  end;
end $$;

-- 4) El estado no se guarda: no hay columna de estado que el navegador pueda escribir.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'student_challenges'
      and column_name in ('status', 'completed_at', 'score')
  ) then
    raise exception 'FALLO: el estado debería derivarse de student_activity, no guardarse';
  end if;
end $$;

-- 5) La baja de la alumna arrastra sus retos (nada huérfano).
do $$
declare sid uuid; left_count integer;
begin
  select id into sid from public.students where email = 'prueba-retos@example.test';
  delete from public.students where id = sid;
  select count(*) into left_count from public.student_challenges where student_id = sid;
  if left_count <> 0 then raise exception 'FALLO: quedaron % retos huérfanos', left_count; end if;
end $$;

rollback;
