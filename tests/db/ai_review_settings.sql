-- Prueba de comportamiento de 20261123_ai_review_settings.sql. Se ejecuta en una transacción que se deshace.
begin;
\i supabase/migrations/20261123_ai_review_settings.sql

-- 1) Se puede guardar y cambiar el modo por organización.
insert into public.ai_review_settings (org_id, mode, updated_by) values ('cloud-wdc', 'live', 'test@example.com')
on conflict (org_id) do update set mode = excluded.mode, updated_by = excluded.updated_by;
update public.ai_review_settings set mode = 'shadow' where org_id = 'cloud-wdc';

-- 2) Un modo inventado se rechaza y solo hay una fila por organización.
do $$
begin
  begin
    insert into public.ai_review_settings (org_id, mode, updated_by) values ('otra', 'turbo', 'x');
    raise exception 'debía rechazar un modo que no existe';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_review_settings (org_id, mode, updated_by) values ('cloud-wdc', 'live', 'x');
    raise exception 'debía rechazar una segunda fila para la misma organización';
  exception when unique_violation then null;
  end;
end $$;

-- 3) El navegador (anon/authenticated) no puede leerla ni escribirla.
do $$
begin
  if has_table_privilege('anon', 'public.ai_review_settings', 'select') or has_table_privilege('authenticated', 'public.ai_review_settings', 'select') then
    raise exception 'anon/authenticated no deben tener acceso';
  end if;
end $$;
select org_id, mode from public.ai_review_settings;
rollback;
