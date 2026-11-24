-- Prueba de comportamiento de voice_usage (con rollback). Ejecutar tras aplicar 20261124_voice_usage.sql.
begin;
  do $$ begin
    if not (select relrowsecurity from pg_class where oid = 'public.voice_usage'::regclass) then raise exception 'RLS no activada'; end if;
    if has_table_privilege('anon', 'public.voice_usage', 'select') or has_table_privilege('authenticated', 'public.voice_usage', 'insert') then raise exception 'anon/authenticated no deben acceder'; end if;
  end $$;
  insert into public.students (id, org_id, email, status) values ('00000000-0000-4000-8000-0000000000ba', 'test-org', 'uso@test.dev', 'active');
  insert into public.voice_usage (org_id, student_id, provider, seconds, cost_usd) values ('test-org', '00000000-0000-4000-8000-0000000000ba', 'openai_realtime_mini', 120, 0.1);
  do $$ begin
    if (select day from public.voice_usage where org_id = 'test-org') <> (now() at time zone 'utc')::date then raise exception 'el día por defecto debía ser hoy (UTC)'; end if;
    begin insert into public.voice_usage (org_id, student_id, provider, seconds, cost_usd) values ('test-org', '00000000-0000-4000-8000-0000000000ba', 'x', 0, 0); raise exception '0 segundos aceptado';
    exception when check_violation then null; end;
    begin insert into public.voice_usage (org_id, student_id, provider, seconds, cost_usd) values ('test-org', '00000000-0000-4000-8000-0000000000ba', 'x', 601, 0); raise exception 'más de 10 minutos aceptado';
    exception when check_violation then null; end;
    begin insert into public.voice_usage (org_id, student_id, provider, seconds, cost_usd) values ('test-org', '00000000-0000-4000-8000-0000000000ba', 'x', 10, -1); raise exception 'coste negativo aceptado';
    exception when check_violation then null; end;
  end $$;
  delete from public.students where id = '00000000-0000-4000-8000-0000000000ba';
  do $$ begin if exists (select 1 from public.voice_usage where org_id = 'test-org') then raise exception 'el consumo debía borrarse con la alumna'; end if; end $$;
rollback;
