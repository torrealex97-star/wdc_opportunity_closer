-- Prueba de conducta con BEGIN…ROLLBACK. NO ejecutar con execute_sql sin la orden del propietario.
-- Uso: psql -v ON_ERROR_STOP=1 -f tests/db/training_curriculum.sql
begin;

insert into public.training_modules (id, position, title, description, objectives)
values ('test-module', 1, 'Módulo de prueba', 'Descripción del módulo de prueba.', '["Objetivo uno"]'::jsonb);

insert into public.training_lessons (id, module_id, position, title, summary, minutes, content, key_points)
values ('test-lesson', 'test-module', 1, 'Lección de prueba', 'Resumen de la lección de prueba.', 5, repeat('Contenido de la lección. ', 4), '["Idea uno"]'::jsonb);

insert into public.training_resources (id, lesson_id, type, title, description, content)
values ('test-resource', 'test-lesson', 'checklist', 'Checklist de prueba', 'Recurso de la prueba.', 'Primero, segundo y tercero.');

insert into public.training_questions (id, lesson_id, position, type, prompt, options, correct, explanation)
values ('test-question', 'test-lesson', 1, 'multiple', '¿Cuál es la respuesta correcta?', '["Incorrecta","Correcta"]'::jsonb, 1, 'La segunda opción es la correcta porque así lo dice la explicación.');

do $$
declare n int;
begin
  select count(*) into n from public.training_lessons where module_id = 'test-module';
  if n <> 1 then raise exception 'RLS_OK falló: lección no insertada'; end if;
  begin
    insert into public.training_questions (id, lesson_id, position, type, prompt, options, correct, explanation)
    values ('test-bad', 'test-lesson', 2, 'multiple', 'Pregunta con índice fuera de rango', '["A","B"]'::jsonb, 5, 'Explicación suficientemente larga para pasar el mínimo.');
    raise exception 'RLS_OK falló: se aceptó un índice correcto fuera de rango';
  exception when check_violation then null;
  end;
end $$;

select 'RLS_OK' as result;
rollback;
