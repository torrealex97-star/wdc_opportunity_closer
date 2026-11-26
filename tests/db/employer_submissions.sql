-- Prueba de comportamiento de employer_submissions (con rollback). Ejecutar tras aplicar 20261126_employer_submissions.sql.
begin;
  do $$ begin
    if not (select relrowsecurity from pg_class where oid = 'public.employer_submissions'::regclass) then raise exception 'RLS no activada'; end if;
    if has_table_privilege('anon', 'public.employer_submissions', 'select') or has_table_privilege('authenticated', 'public.employer_submissions', 'insert') then raise exception 'anon/authenticated no deben acceder'; end if;
  end $$;
  insert into public.employer_submissions (org_id, offer_external_id, company, contact_name, contact_email, offer_url, ip_hash)
    values ('test-org', 'emp-0123456789abcdef', 'Academia Delta', 'Marta Ruiz', 'marta@delta.example.com', 'https://delta.example.com/empleo/closer', 'a1b2c3d4e5f60718');
  do $$ begin
    begin insert into public.employer_submissions (org_id, offer_external_id, company, contact_name, contact_email, offer_url, ip_hash) values ('test-org', 'emp-0123456789abcdef', 'Otra', 'Ana Pérez', 'ana@otra.example.com', 'https://otra.example.com/x', 'a1b2c3d4e5f60718'); raise exception 'misma oferta aceptada dos veces';
    exception when unique_violation then null; end;
    begin insert into public.employer_submissions (org_id, offer_external_id, company, contact_name, contact_email, offer_url, ip_hash) values ('test-org', 'emp-ffffffffffffffff', 'Otra', 'Ana Pérez', 'no-es-un-email', 'https://otra.example.com/x', 'a1b2c3d4e5f60718'); raise exception 'email inválido aceptado';
    exception when check_violation then null; end;
    begin insert into public.employer_submissions (org_id, offer_external_id, company, contact_name, contact_email, offer_url, ip_hash) values ('test-org', 'emp-eeeeeeeeeeeeeeee', 'Otra', 'Ana Pérez', 'ana@otra.example.com', 'http://otra.example.com/x', 'a1b2c3d4e5f60718'); raise exception 'enlace http aceptado';
    exception when check_violation then null; end;
    begin insert into public.employer_submissions (org_id, offer_external_id, company, contact_name, contact_email, offer_url, ip_hash) values ('test-org', 'oferta-sin-huella', 'Otra', 'Ana Pérez', 'ana@otra.example.com', 'https://otra.example.com/x', 'a1b2c3d4e5f60718'); raise exception 'huella con formato inválido aceptada';
    exception when check_violation then null; end;
    begin insert into public.employer_submissions (org_id, offer_external_id, company, contact_name, contact_email, offer_url, ip_hash) values ('test-org', 'emp-dddddddddddddddd', 'X', 'Ana Pérez', 'ana@otra.example.com', 'https://otra.example.com/x', 'a1b2c3d4e5f60718'); raise exception 'empresa de 1 carácter aceptada';
    exception when check_violation then null; end;
  end $$;
  -- la misma huella en otra organización sí es válida
  insert into public.employer_submissions (org_id, offer_external_id, company, contact_name, contact_email, offer_url, ip_hash) values ('otra-org', 'emp-0123456789abcdef', 'Academia Delta', 'Marta Ruiz', 'marta@delta.example.com', 'https://delta.example.com/empleo/closer', 'a1b2c3d4e5f60718');
  do $$ begin if (select count(*) from public.employer_submissions where org_id = 'test-org') <> 1 then raise exception 'conteo por organización incorrecto'; end if; end $$;
rollback;
