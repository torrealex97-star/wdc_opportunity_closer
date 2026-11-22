// Bright Data como proveedor real y testeable, SIN clave ni red: fetch simulado y fixtures con la
// forma que documenta su API. Cubre el contrato (endpoint, cabecera, cuerpo y mapeo), el HTML del
// Unlocker, un único reintento en 429/503, los errores tipados (auth/zona/transporte/payload), el
// tope mensual y que «Guardar» una clave no hace ninguna llamada de gasto.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/brightdata.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Entorno mínimo para que `saveConnection` cifre la clave y hable con un Supabase simulado.
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.ADMIN_SECRETS_KEY = 'admin-secrets-test';

const {
  BRIGHTDATA_USD_PER_REQUEST, BrightDataError, serpJobs, unlockHtml, serpProbeRequest,
} = await import('../../apps/web/lib/providers/brightdata.ts');
const { capUsd, canSpend, costFromNote, spendNote, spentFromNotes } = await import('../../apps/web/lib/providerBudget.ts');
const { saveConnection } = await import('../../apps/web/lib/integrations.ts');

const payload = JSON.parse(readFileSync(new URL('../fixtures/brightdata/serp-jobs.json', import.meta.url), 'utf8'));
const page = readFileSync(new URL('../fixtures/brightdata/page.html', import.meta.url), 'utf8');
const config = { apiKey: 'bd-key-1234', serpZone: 'serp_zone', unlockerZone: 'unlock_zone' };

async function failure(run) {
  try { await run(); } catch (err) { return err; }
  assert.fail('la llamada debía fallar y no falló');
}

const realFetch = globalThis.fetch;
try {
  // 1) Contrato de la búsqueda: POST, Bearer, cuerpo exacto y Google Jobs con ibp=htl;jobs.
  {
    const calls = [];
    const result = await serpJobs(config, {
      query: 'closer de ventas', gl: 'es', hl: 'es',
      fetchImpl: async (target, init) => { calls.push({ target, init }); return new Response(JSON.stringify(payload), { status: 200 }); },
    });
    assert.equal(calls.length, 1, 'una búsqueda = una petición');
    assert.equal(calls[0].target, 'https://api.brightdata.com/request');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer bd-key-1234');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(body).sort(), ['format', 'url', 'zone']);
    assert.equal(body.zone, 'serp_zone');
    assert.equal(body.format, 'raw', 'raw + brd_json=1: el JSON de Google llega directo, sin el sobre {status_code, headers, body}');
    assert.match(body.url, /[?&]q=closer(?:\+|%20)de(?:\+|%20)ventas(?:&|$)/);
    assert.match(body.url, /ibp=htl%3Bjobs/, 'Google Jobs se pide con ibp=htl%3Bjobs');
    assert.match(body.url, /brd_json=1/, 'brd_json=1 pide el JSON interpretado a Bright Data');
    assert.equal(result.rawItems, 3);
    assert.equal(result.candidates.length, 2, 'sin enlace no hay oferta verificable');
    assert.equal(result.requests, 1);
    assert.equal(result.costUsd, BRIGHTDATA_USD_PER_REQUEST);
    const [first] = result.candidates;
    assert.deepEqual(Object.keys(first).sort(), ['company', 'description', 'external_id', 'location', 'posted_at', 'raw', 'salary', 'title', 'url'], 'mismo Candidate que SerpApi');
    assert.equal(first.title, 'Closer high ticket');
    assert.equal(first.company, 'Acme');
    assert.equal(first.location, 'Madrid, España');
    assert.equal(first.url, 'https://www.infojobs.net/oferta/1');
    assert.equal(first.salary, null, 'sin salario no se inventa');
    assert.equal(first.posted_at, null, 'el fixture documentado no trae fecha: no se inventa');
    assert.match(first.description, /Ventas B2B/);
    assert.match(first.description, /Remoto/, 'las tags se conservan, no se descartan');
    assert.equal(first.raw.site, 'InfoJobs', 'la fuente se conserva en la evidencia');
    assert.match(first.external_id, /^bd-/);
  }

  // 2) Unlocker: devuelve el HTML crudo para el extractor común y usa la zona del Unlocker.
  {
    const calls = [];
    const result = await unlockHtml(config, 'https://portal.test/oferta', {
      fetchImpl: async (target, init) => { calls.push({ target, init }); return new Response(page, { status: 200 }); },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, 'https://api.brightdata.com/request');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer bd-key-1234');
    assert.deepEqual(JSON.parse(calls[0].init.body), { zone: 'unlock_zone', url: 'https://portal.test/oferta', format: 'raw' });
    assert.equal(result.html, page, 'el HTML llega sin transformar');
    assert.equal(result.requests, 1);
    assert.equal(result.costUsd, BRIGHTDATA_USD_PER_REQUEST);
  }

  // 3) Un 429 se reintenta UNA vez y el segundo intento se cuenta y se cobra.
  {
    let n = 0;
    const result = await serpJobs(config, {
      query: 'x',
      fetchImpl: async () => {
        n += 1;
        return n === 1 ? new Response('busy', { status: 429 }) : new Response(JSON.stringify(payload), { status: 200 });
      },
    });
    assert.equal(n, 2, 'exactamente un reintento');
    assert.equal(result.requests, 2);
    assert.equal(result.costUsd, BRIGHTDATA_USD_PER_REQUEST * 2);
  }

  // 4) Un 503 también se reintenta una vez.
  {
    let n = 0;
    const result = await serpJobs(config, {
      query: 'x',
      fetchImpl: async () => {
        n += 1;
        return n === 1 ? new Response('unavailable', { status: 503 }) : new Response(JSON.stringify(payload), { status: 200 });
      },
    });
    assert.equal(n, 2, 'exactamente un reintento en 503');
    assert.equal(result.requests, 2);
  }

  // 5) Un 500 se reintenta una vez, igual que el resto de 5xx: el reintento se cuenta y se cobra.
  {
    let n = 0;
    const err = await failure(() => serpJobs(config, {
      query: 'x',
      fetchImpl: async () => { n += 1; return new Response('boom', { status: 500 }); },
    }));
    assert.equal(n, 2, 'un 500 se reintenta una vez');
    assert.equal(err.status, 500, 'un error HTTP lleva su estado');
    assert.equal(err.status, 500);
  }

  // 6) Auth: 401/403 no se reintentan y quedan tipados como auth.
  {
    let n = 0;
    const err = await failure(() => serpJobs(config, {
      query: 'x',
      fetchImpl: async () => { n += 1; return new Response('nope', { status: 401 }); },
    }));
    assert.equal(n, 1);
    assert.ok(err instanceof BrightDataError);
    assert.equal(err.status, 401, 'un 401 no se reintenta y queda tipado por su estado');
    assert.equal(err.status, 401);
  }

  // 7) Zona ausente: se declara antes de gastar; no hay petición.
  {
    let n = 0;
    const serp = await failure(() => serpJobs({ ...config, serpZone: null }, {
      query: 'x', fetchImpl: async () => { n += 1; return new Response('', { status: 200 }); },
    }));
    assert.equal(serp.status, 422, 'sin zona SERP no hay petición');
    const html = await failure(() => unlockHtml({ ...config, unlockerZone: null }, 'https://portal.test', {
      fetchImpl: async () => { n += 1; return new Response('', { status: 200 }); },
    }));
    assert.equal(html.status, 422, 'sin zona de Unlocker no hay petición');
    assert.equal(n, 0, 'sin zona no se hace ninguna petición que se cobraría');
  }

  // 8) Transporte: dos fallos de red, sin HTTP inventado, y ambos intentos declarados.
  {
    let n = 0;
    const err = await failure(() => serpJobs(config, {
      query: 'x',
      fetchImpl: async () => { n += 1; throw new Error('timeout'); },
    }));
    assert.equal(n, 2, 'un fallo de red se reintenta una vez');
    assert.equal(err.status, null, 'un fallo de red no inventa un estado HTTP');
    assert.equal(err.status, null, 'un fallo de red no inventa un HTTP');
    assert.equal(err.attempts, 2, 'los dos intentos se declaran para poder anotarlos');
  }

  // 9) Payload: un 200 ilegible o sin jobs.items[] se declara, no se convierte en «0 ofertas».
  {
    const broken = await failure(() => serpJobs(config, {
      query: 'x', fetchImpl: async () => new Response('no es JSON', { status: 200 }),
    }));
    assert.equal(broken.status, 200, 'un payload roto llega con 200 y se declara');
    assert.equal(broken.status, 200);
    assert.equal(broken.attempts, 1);
    // `{ jobs: {} }` sin `items[]`: no se inventan ofertas ni se finge un cero comprobado.
    const shape = await serpJobs(config, {
      query: 'x', fetchImpl: async () => new Response(JSON.stringify({ jobs: {} }), { status: 200 }),
    });
    assert.deepEqual(shape.candidates, [], 'sin items[] no hay ofertas que devolver');
    assert.equal(shape.rawItems, 0, 'sin items[] no se inventa un recuento');
    const empty = await serpJobs(config, {
      query: 'x', fetchImpl: async () => new Response(JSON.stringify({ jobs: { items: [] } }), { status: 200 }),
    });
    assert.deepEqual(empty.candidates, [], 'la lista vacía documentada sí es un cero legítimo');
    assert.equal(empty.requests, 1);
  }

  // 10) La prueba del panel hace UNA búsqueda y NO reintenta: el 429 se devuelve tal cual.
  {
    let n = 0;
    const response = await serpProbeRequest({ ...config, serpZone: 'serp_zone' }, async () => {
      n += 1;
      return new Response('busy', { status: 429 });
    });
    assert.equal(n, 1, '«Probar» no reintenta: se cobraría dos veces');
    assert.equal(response.status, 429);
  }

  // 11) Tope: 5 USD por defecto, se frena al alcanzarlo y la nota se puede volver a sumar.
  {
    assert.equal(capUsd('brightdata', {}), 5, 'BRIGHTDATA_MONTHLY_USD sin definir vale 5');
    assert.equal(capUsd('brightdata', { BRIGHTDATA_MONTHLY_USD: '2' }), 2);
    const blocked = canSpend('brightdata', 5, {});
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason ?? '', /Quedan 0\.00 USD/);
    assert.equal(canSpend('brightdata', 4.99, {}).ok, true);
    assert.equal(canSpend('brightdata', 4.998, { BRIGHTDATA_MONTHLY_USD: '5' }, 2).ok, false, 'reserva los dos intentos');
    const note = spendNote({ route: '3/5', provider: 'brightdata', requests: 2, costUsd: 0.003, detail: 'infojobs' });
    assert.match(note, /ruta 3\/5/);
    assert.match(note, /proveedor=brightdata/);
    assert.match(note, /2 petición\(es\)/);
    assert.match(note, /coste_usd=0\.003000/);
    assert.equal(costFromNote(note), 0.003);
    assert.equal(spentFromNotes([{ note }], 'brightdata').usd, 0.003);
  }

  // 12) «Guardar» solo escribe la clave cifrada: ni Bright Data ni una ejecución de gasto.
  {
    const calls = [];
    globalThis.fetch = async (target, init) => {
      calls.push({ target: String(target), init });
      return new Response('[]', { status: 201 });
    };
    const saved = await saveConnection('brightdata', 'bd-secret-key-1234:serp_zone', 'owner@test');
    assert.equal(saved, true);
    assert.equal(calls.length, 1, 'Guardar hace una sola escritura, la de la tabla de conexiones');
    assert.match(calls[0].target, /\/rest\/v1\/integration_connections/);
    assert.equal(calls.some(call => /api\.brightdata\.com/.test(call.target)), false, 'Guardar no llama a Bright Data');
    assert.equal(calls.some(call => /external_ingest_runs/.test(call.target)), false, 'Guardar no anota gasto');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.last4, '1234', 'solo los últimos 4 de la clave se guardan en claro (no la zona)');
    assert.equal(body.secret_ciphertext.includes('bd-secret-key-1234'), false, 'la clave no se guarda en claro');
    assert.equal(body.last_test_ok, null, 'guardar no marca la clave como probada');
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log('PASS  Bright Data: contrato, unlock, 429/503 con un reintento, errores tipados, payload, tope y Guardar sin gasto');
