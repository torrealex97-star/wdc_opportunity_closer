-- Prueba de comportamiento de source_targets (con rollback). Ejecutar tras aplicar 20261124_source_targets.sql.
begin;
  do $$ begin
    if not (select relrowsecurity from pg_class where oid = 'public.source_targets'::regclass) then raise exception 'RLS no activada'; end if;
    if has_table_privilege('anon', 'public.source_targets', 'select') or has_table_privilege('authenticated', 'public.source_targets', 'insert') then raise exception 'anon/authenticated no deben acceder'; end if;
  end $$;
  insert into public.source_targets (org_id, source, kind, url, label) values ('test-org', 'apify-telegram', 'telegram_channel', 'https://t.me/empleo_closers', 'Closers España');
  do $$ begin
    if (select enabled from public.source_targets where org_id = 'test-org') is not true then raise exception 'debía nacer activa'; end if;
    begin insert into public.source_targets (org_id, source, kind, url) values ('test-org', 'apify-telegram', 'telegram_channel', 'https://t.me/empleo_closers'); raise exception 'duplicado aceptado'
    exception when unique_violation then null; end;
    begin insert into public.source_targets (org_id, source, kind, url) values ('test-org', 'apify-facebook', 'facebook_group', 'http://facebook.com/groups/x'); raise exception 'http aceptado'
    exception when check_violation then null; end;
    begin insert into public.source_targets (org_id, source, kind, url) values ('test-org', 'apify-facebook', 'otra_cosa', 'https://facebook.com/groups/x'); raise exception 'tipo desconocido aceptado'
    exception when check_violation then null; end;
    begin insert into public.source_targets (org_id, source, kind, url) values ('test-org', 'Fuente Mala', 'facebook_group', 'https://facebook.com/groups/x'); raise exception 'código de fuente inválido aceptado'
    exception when check_violation then null; end;
    begin insert into public.source_targets (org_id, source, kind, url) values ('test-org', 'apify-facebook', 'facebook_group', 'https://' || repeat('a', 600)); raise exception 'URL de más de 500 caracteres aceptada'
    exception when check_violation then null; end;
  end $$;
  -- la misma URL en otra fuente u otra organización sí es válida
  insert into public.source_targets (org_id, source, kind, url) values ('test-org', 'apify-skool', 'skool_community', 'https://www.skool.com/closers-club'), ('otra-org', 'apify-telegram', 'telegram_channel', 'https://t.me/empleo_closers');
  do $$ begin if (select count(*) from public.source_targets where org_id = 'test-org') <> 2 then raise exception 'conteo por organización incorrecto'; end if; end $$;
rollback;
