-- Prueba de comportamiento de 20261121_integration_connections_providers.sql. Todo va dentro de una
-- transacción que se revierte: no deja filas. Ejecutar completo en el SQL Editor de Supabase.
-- No pisa ninguna clave existente: un proveedor que ya tiene fila cuenta como admitido (unique_violation).
begin;
  do $$
  declare p text;
  begin
    foreach p in array array['apify', 'serpapi', 'groq', 'openai', 'adzuna', 'jooble', 'infojobs',
                               'resend', 'brightdata', 'zenrows', 'scrapingbee'] loop
      begin
        insert into public.integration_connections (provider, secret_ciphertext, last4, updated_by)
        values (p, 'x.y.z', '1234', 'test');
      exception
        when unique_violation then null; -- ya hay una clave guardada: el CHECK la admite igual
      end;
    end loop;
    -- Un proveedor inventado sigue rechazándose: el CHECK no se ha vuelto permisivo.
    begin
      insert into public.integration_connections (provider, secret_ciphertext, last4, updated_by)
      values ('inventado', 'x.y.z', '1234', 'test');
      raise exception 'FALLO: proveedor inventado aceptado';
    exception when check_violation then null;
    end;
  end $$;
rollback;
