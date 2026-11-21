// Tope por organización: `monthly_usd` de `provider_budget` manda y el entorno es el respaldo declarado.
// Antes `capUsd()` solo miraba la variable de entorno, así que cambiar el importe en la tabla no cambiaba
// ningún límite. Sin red: PostgREST simulado con `fetch` falso.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/provider-budget-org.mjs

import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const { canSpend, capFromRow, envCap, parseCapUsd } = await import('../../apps/web/lib/providerBudget.ts');
const { capForOrg, readCaps } = await import('../../apps/web/lib/providerBudgetStore.ts');

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (condition, message) => { assert.ok(condition, message); checks++; };

const realFetch = globalThis.fetch;
const calls = [];
let reply = () => new Response(JSON.stringify([]), { status: 200 });
globalThis.fetch = async (target, init) => { calls.push({ url: String(target), init }); return reply(String(target), init); };
const withRows = (list) => { calls.length = 0; reply = () => new Response(JSON.stringify(list), { status: 200 }); };

try {
  // 1) La tabla manda sobre el entorno, y una sola consulta da los cuatro topes.
  process.env.BRIGHTDATA_MONTHLY_USD = '5';
  withRows([{ provider: 'brightdata', monthly_usd: 12, updated_by: 'dueño' }, { provider: 'serpapi', monthly_usd: 4, updated_by: 'dueño' }]);
  const caps = await readCaps();
  eq(caps.brightdata.usd, 12, 'el importe de la tabla manda sobre BRIGHTDATA_MONTHLY_USD');
  eq(caps.brightdata.source, 'tabla', 'el tope se declara como «tabla»');
  eq(caps.brightdata.error, null, 'sin error cuando la tabla responde');
  eq(caps.serpapi.usd, 4, 'cada proveedor lee su propia fila');
  eq(calls.length, 1, 'los cuatro topes salen de una sola consulta');
  ok(calls[0].url.startsWith('https://supabase.test/rest/v1/provider_budget?org_id=eq.cloud-wdc&select=provider,monthly_usd'), `la consulta pide la organización y las dos columnas: ${calls[0].url}`);
  ok(String(calls[0].init?.headers?.Authorization ?? '').includes('service-role-test'), 'la tabla se lee con la clave de servicio, nunca desde el navegador');

  // 2) Cambiar la fila cambia la decisión de gasto de verdad (lo que antes no pasaba).
  ok(canSpend('brightdata', 11.99, process.env, 1, caps.brightdata.usd).ok, 'con 12 en la tabla cabe un gasto de 11,99');
  ok(!canSpend('brightdata', 11.99, process.env).ok, 'sin el tope de la tabla, el respaldo del entorno (5) lo bloquea');
  withRows([{ provider: 'brightdata', monthly_usd: 2, updated_by: 'dueño' }]);
  const low = await capForOrg('brightdata');
  eq(low.usd, 2, 'bajar la tabla a 2 baja el tope efectivo');
  ok(!canSpend('brightdata', 1.9999, {}, 2, low.usd).ok, 'con 2 no caben los dos intentos reservados');

  // 2b) La semilla de la migración (filas sin `updated_by`) no es una decisión del propietario: no pisa el entorno.
  process.env.SERPAPI_MONTHLY_USD = '1';
  withRows([{ provider: 'serpapi', monthly_usd: 5, updated_by: null }]);
  const seeded = await capForOrg('serpapi');
  eq(seeded.usd, 1, 'una fila sembrada (5 USD, sin updated_by) no sustituye al SERPAPI_MONTHLY_USD del operador');
  eq(seeded.source, 'entorno');
  delete process.env.SERPAPI_MONTHLY_USD;
  withRows([{ provider: 'serpapi', monthly_usd: 3, updated_by: 'dueño', updated_at: '2026-11-21T10:00:00Z' }]);
  const saved = await capForOrg('serpapi');
  eq(saved.updated_by, 'dueño', 'quién lo guardó viaja con el tope');
  eq(saved.updated_at, '2026-11-21T10:00:00Z');

  // 3) Cero es un tope válido y significa «aquí no se gasta».
  withRows([{ provider: 'serpapi', monthly_usd: 0, updated_by: 'dueño' }]);
  const zero = await capForOrg('serpapi');
  eq(zero.usd, 0, 'el 0 se respeta, no se sustituye por el entorno');
  eq(zero.source, 'tabla');
  const denied = canSpend('serpapi', 0, {}, 1, zero.usd);
  ok(!denied.ok, 'con tope 0 no se lanza nada');
  ok(/es 0/.test(String(denied.reason)), `el motivo dice que el tope es 0: ${denied.reason}`);

  // 4) Un importe ilegible no se recorta en silencio: se cae al entorno y se declara.
  process.env.SERPAPI_MONTHLY_USD = '3';
  withRows([{ provider: 'serpapi', monthly_usd: 'mucho', updated_by: 'dueño' }]);
  const bad = await capForOrg('serpapi');
  eq(bad.usd, 3, 'el importe inválido cae al entorno');
  eq(bad.source, 'entorno');
  ok(/no es un importe válido/.test(String(bad.error)), `declara por qué no se usó la tabla: ${bad.error}`);

  // 5) Sin fila: entorno, y sin variable el defecto del proveedor.
  withRows([]);
  process.env.ZENROWS_MONTHLY_USD = '7';
  const envOnly = await capForOrg('zenrows');
  eq(envOnly.usd, 7, 'sin fila, el entorno');
  eq(envOnly.source, 'entorno');
  eq(envOnly.error, null, 'sin fila no es un error: es el respaldo previsto');
  delete process.env.SCRAPINGBEE_MONTHLY_USD;
  const dflt = await capForOrg('scrapingbee');
  eq(dflt.usd, 5, 'sin fila ni variable, el defecto documentado');
  eq(dflt.source, 'defecto');

  // 6) Tabla ilegible (HTTP 500, red caída o cuerpo que no es lista): respaldo declarado, nunca un cero falso.
  calls.length = 0; reply = () => new Response('boom', { status: 500 });
  const failed = await readCaps();
  ok(/HTTP 500/.test(String(failed.brightdata.error)), `declara el HTTP al no poder leer: ${failed.brightdata.error}`);
  eq(failed.brightdata.usd, 5, 'con la tabla caída se usa el entorno, no 0');
  ok(!canSpend('brightdata', 4.999, process.env, 1, failed.brightdata.usd).ok, 'y el respaldo sigue bloqueando el exceso');

  reply = () => { throw new Error('ECONNRESET'); };
  const offline = await capForOrg('serpapi');
  eq(offline.usd, 3, 'red caída: respaldo del entorno');
  ok(/No se pudo consultar/.test(String(offline.error)), `declara que no se pudo consultar: ${offline.error}`);

  reply = () => new Response(JSON.stringify({ message: 'raro' }), { status: 200 });
  const weird = await capForOrg('zenrows');
  eq(weird.usd, 7, 'respuesta que no es lista: respaldo del entorno');
  ok(/no devolvió una lista/.test(String(weird.error)), `declara la forma inesperada: ${weird.error}`);

  // 7) Se pide por organización y no se mezclan proveedores.
  withRows([{ provider: 'zenrows', monthly_usd: 2.5, updated_by: 'dueño' }]);
  const other = await readCaps('otra-org');
  eq(other.zenrows.usd, 2.5, 'lee la fila del proveedor pedido');
  eq(other.brightdata.usd, 5, 'la fila de otro proveedor no se mezcla');
  ok(calls[0].url.includes('org_id=eq.otra-org'), `el tope se pide por organización: ${calls[0].url}`);

  // 8) Límites del importe, sin red: el mismo rango que el CHECK de la tabla.
  eq(parseCapUsd(0), 0, 'el 0 es válido');
  eq(parseCapUsd('2.567'), 2.57, 'se redondea a dos decimales');
  eq(parseCapUsd(5000), 5000, '5.000 es el máximo');
  eq(parseCapUsd(5000.01), null, 'por encima del máximo no vale');
  eq(parseCapUsd(-1), null, 'un negativo no vale');
  eq(parseCapUsd(''), null, 'vacío no vale');
  eq(parseCapUsd(null), null, 'null no vale');
  eq(capFromRow('brightdata', { monthly_usd: 4 }, {}).source, 'tabla', 'la fila válida gana');
  eq(envCap('brightdata', { BRIGHTDATA_MONTHLY_USD: 'x' }).usd, 5, 'una variable ilegible deja el defecto, no cero');
} finally {
  globalThis.fetch = realFetch;
}

console.log(`provider-budget-org: PASS (${checks} comprobaciones)`);
