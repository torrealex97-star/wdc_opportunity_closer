-- Prueba de comportamiento de student_alert_prefs y student_alerts (con rollback). Ejecutar tras aplicar 20261127_student_alerts.sql.
begin;
  do $$ begin
    if not (select relrowsecurity from pg_class where oid = 'public.student_alerts'::regclass) or not (select relrowsecurity from pg_class where oid = 'public.student_alert_prefs'::regclass) then raise exception 'RLS no activada'; end if;
    if has_table_privilege('anon', 'public.student_alerts', 'select') or has_table_privilege('authenticated', 'public.student_alerts', 'insert')
       or has_table_privilege('anon', 'public.student_alert_prefs', 'select') or has_table_privilege('authenticated', 'public.student_alert_prefs', 'update') then raise exception 'anon/authenticated no deben acceder'; end if;
  end $$;
  insert into public.student_alert_prefs (org_id, user_id, opted_in_at, opt_in_version) values ('test-org', '11111111-1111-1111-1111-111111111111', now(), 'v1-borrador');
  insert into public.student_alerts (org_id, user_id, offer_id) values ('test-org', '11111111-1111-1111-1111-111111111111', 'oferta-1');
  do $$ begin
    begin insert into public.student_alerts (org_id, user_id, offer_id) values ('test-org', '11111111-1111-1111-1111-111111111111', 'oferta-1'); raise exception 'misma oferta avisada dos veces';
    exception when unique_violation then null; end;
    begin insert into public.student_alerts (org_id, user_id, offer_id, status) values ('test-org', '11111111-1111-1111-1111-111111111111', 'oferta-2', 'enviado'); raise exception 'estado fuera de la lista aceptado';
    exception when check_violation then null; end;
    begin insert into public.student_alerts (org_id, user_id, offer_id) values ('test-org', '11111111-1111-1111-1111-111111111111', ''); raise exception 'oferta vacía aceptada';
    exception when check_violation then null; end;
    begin insert into public.student_alert_prefs (org_id, user_id, opted_in_at) values ('test-org', '22222222-2222-2222-2222-222222222222', now()); raise exception 'consentimiento sin versión aceptado';
    exception when check_violation then null; end;
  end $$;
  -- reclamo atómico: solo una de dos actualizaciones «pending → sending» gana
  do $$ declare a int; b int; begin
    update public.student_alerts set status = 'sending' where org_id = 'test-org' and offer_id = 'oferta-1' and status = 'pending'; get diagnostics a = row_count;
    update public.student_alerts set status = 'sending' where org_id = 'test-org' and offer_id = 'oferta-1' and status = 'pending'; get diagnostics b = row_count;
    if a <> 1 or b <> 0 then raise exception 'el reclamo no es atómico (% / %)', a, b; end if;
  end $$;
  -- la misma oferta para la misma alumna en otra organización es válida
  insert into public.student_alerts (org_id, user_id, offer_id) values ('otra-org', '11111111-1111-1111-1111-111111111111', 'oferta-1');
rollback;
