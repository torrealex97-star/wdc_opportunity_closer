-- Prueba de comportamiento (con rollback): claves de voz admitidas y registro de incidencias de proveedor.
begin;
  do $$ begin
    if not (select relrowsecurity from pg_class where oid = 'public.voice_provider_events'::regclass) then raise exception 'RLS no activada'; end if;
    if has_table_privilege('anon', 'public.voice_provider_events', 'select') or has_table_privilege('authenticated', 'public.voice_provider_events', 'insert') then raise exception 'anon/authenticated no deben acceder'; end if;
  end $$;
  insert into public.voice_provider_events (org_id, provider, kind, detail) values ('test-org', 'deepgram_agent', 'payment', 'HTTP 402');
  do $$ begin
    begin insert into public.voice_provider_events (org_id, provider, kind) values ('test-org', 'nadie', 'ok'); raise exception 'proveedor desconocido aceptado';
    exception when check_violation then null; end;
    begin insert into public.voice_provider_events (org_id, provider, kind) values ('test-org', 'deepgram_agent', 'roto'); raise exception 'tipo desconocido aceptado';
    exception when check_violation then null; end;
    begin insert into public.voice_provider_events (org_id, provider, kind, detail) values ('test-org', 'deepgram_agent', 'error', repeat('x', 201)); raise exception 'nota larga aceptada';
    exception when check_violation then null; end;
  end $$;
rollback;
