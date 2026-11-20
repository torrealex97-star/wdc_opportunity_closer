// Workable: extractor sin red con una respuesta recortada de la API real (2026-11-20). Lo que se fija:
// que el país se pida por su nombre (con «Latin America» NO se aplica el filtro), que la empresa llegue
// como objeto y se aplane, que la modalidad salga del campo estructurado `workplace`, que el ruido se
// cuente antes de escribir y que un término caído no tumbe los demás.
// Uso: node --experimental-strip-types tests/engine/workable.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const stage = join(mkdtempSync(join(tmpdir(), 'wdc-workable-')), 'worker.mjs');
copyFileSync(fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url)), stage);
const worker = await import(pathToFileURL(stage).href);
const { sourceWorkable, SOURCES, fetchCost, filteredOf, resetExtractFiltered } = worker.__test;

// Respuesta real recortada (query=closer&location=Spain, 2026-11-20): cuatro ofertas, de las que dos
// son del perfil y una es ruido con la palabra «close» en otro oficio.
const SPAIN = {
  title: 'Workable',
  totalSize: 4,
  jobs: [
    {
      department: 'BDR ES', id: '24f0d558-f550-4edd-afe8-7add36af2c09',
      title: 'Account Executive - High Ticket Closer',
      description: '<p>Buscamos un closer con experiencia en cierre de ventas high ticket.</p>',
      employmentType: 'Full-time', language: 'en',
      url: 'https://jobs.workable.com/view/5yzehpLm7jnCBpiFQn1NUZ/account-executive',
      locations: "['TELECOMMUTE', 'Spain']",
      location: { city: '', subregion: null, countryName: 'Spain' },
      created: '2026-06-24T14:09:23.914Z', updated: '2026-06-24T14:09:23.914Z',
      company: { id: '09a57794-11c9-4e2d-a216-a2f5448b11ed', title: 'Huzzle', website: 'https://huzzle.app' },
      isFeatured: 'False', workplace: 'remote',
    },
    {
      department: '', id: '7a1c9b7e-0000-4000-8000-000000000002',
      title: 'Close Protection Officer - Madrid',
      description: '<p>Seguridad privada para directivos.</p>',
      url: 'https://jobs.workable.com/view/preview/close-protection-madrid',
      location: { city: 'Madrid', subregion: 'Community of Madrid', countryName: 'Spain' },
      created: '2026-11-11T09:00:00.000Z',
      company: { id: 'c2', title: 'Prevail' }, workplace: 'hybrid',
    },
    {
      department: 'Sales', id: '9f2d0d6c-0000-4000-8000-000000000003',
      title: 'Sales Partner - RealAdvisor (Mercado Español)',
      description: '<p>Buscamos vendedores con mentalidad de closer.</p>',
      url: 'https://jobs.workable.com/view/realadvisor-sales-partner',
      location: { city: '', subregion: null, countryName: 'Spain' },
      created: '2026-11-16T14:09:23.914Z',
      company: { id: 'c3', title: 'RealAdvisor S.A.' }, workplace: 'remote',
    },
  ],
};

const realFetch = globalThis.fetch;
const respond = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

try {
  // 1) Campos reales, país por nombre y modalidad declarada por la fuente.
  {
    const urls = [];
    globalThis.fetch = async url => { urls.push(String(url)); return respond(SPAIN); };
    resetExtractFiltered();
    const rows = await sourceWorkable({ code: 'workable-es', locations: ['Spain'], terms: true, termsPerRun: 2 });
    assert.equal(urls.length, 2, 'una petición por término');
    for (const url of urls) {
      assert.match(url, /jobs\.workable\.com\/api\/v1\/jobs\?query=/);
      assert.match(url, /&location=Spain/, 'el país se pide por su nombre, no por región inventada');
      assert.ok(!/Latin%20America/.test(url), '«Latin America» no es un filtro que la API aplique');
    }
    const closer = rows.find(r => r.payload.title === 'Account Executive - High Ticket Closer');
    assert.ok(closer, 'la oferta de closer entra');
    assert.equal(closer.payload.company, 'Huzzle', 'la empresa llega como objeto y se aplana');
    assert.equal(closer.payload.location, 'Spain · remoto', 'la modalidad sale de `workplace`, no se supone');
    assert.equal(closer.payload.url, 'https://jobs.workable.com/view/5yzehpLm7jnCBpiFQn1NUZ/account-executive');
    assert.equal(closer.payload.salary, null, 'la búsqueda no devuelve salario estructurado');
    assert.equal(closer.payload.posted_at, '2026-06-24T14:09:23.914Z');
    assert.equal(closer.payload.raw.search_location, 'Spain', 'se declara con qué país se pidió');
    assert.equal(closer.payload.raw.search_term, closer.payload.raw.search_term, 'y con qué término');
    assert.ok(!rows.some(r => /Close Protection Officer/.test(r.payload.title)), '«close protection» no es ventas');
    assert.ok(filteredOf('workable-es') >= 1, 'el ruido se cuenta, no se esconde');
    assert.equal(new Set(rows.map(r => r.external_id)).size, rows.length, 'sin duplicados dentro de la fuente');
  }

  // 2) Dos términos con la misma oferta no la duplican.
  {
    globalThis.fetch = async () => respond(SPAIN);
    const rows = await sourceWorkable({ code: 'workable-es', locations: ['Spain'], terms: true, termsPerRun: 2 });
    assert.equal(new Set(rows.map(r => r.external_id)).size, rows.length);
  }

  // 3) Con varios países, cada término se pide a uno distinto (y todos de la lista): una sola fuente no
  //    puede mandar todo el volumen a un país por el que no preguntó.
  {
    const urls = [];
    globalThis.fetch = async url => { urls.push(String(url)); return respond(SPAIN); };
    await sourceWorkable({ code: 'workable-latam', locations: ['Mexico', 'Colombia', 'Argentina'], terms: true, termsPerRun: 2 });
    const countries = urls.map(u => decodeURIComponent(u.split('&location=')[1]));
    assert.equal(new Set(countries).size, 2, 'los dos términos van a países distintos');
    for (const c of countries) assert.ok(['Mexico', 'Colombia', 'Argentina'].includes(c), `${c} está en la lista`);
  }

  // 4) Un término que falla no tumba la fuente; si fallan todos, se declara caída con el motivo.
  {
    let n = 0;
    globalThis.fetch = async () => { n++; return n === 1 ? new Response('{}', { status: 500 }) : respond(SPAIN); };
    assert.ok((await sourceWorkable({ code: 'workable-es', locations: ['Spain'], terms: true, termsPerRun: 2 })).length > 0,
      'lo bueno del segundo término se conserva');
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    await assert.rejects(() => sourceWorkable({ code: 'workable-es', locations: ['Spain'], terms: true, termsPerRun: 2 }),
      /ningún término respondió/);
  }
} finally {
  globalThis.fetch = realFetch;
}

// 5) Declarada en el motor con su coste HONESTO: dos términos y un reintento posible por término.
const es = SOURCES.find(s => s.code === 'workable-es');
const latam = SOURCES.find(s => s.code === 'workable-latam');
assert.ok(es && latam, 'workable-es y workable-latam están en SOURCES');
assert.equal(es.kind, 'workable');
assert.deepEqual(es.locations, ['Spain']);
assert.deepEqual(latam.locations, ['Mexico', 'Colombia', 'Argentina'], 'LATAM se pide país por país');
assert.equal(fetchCost(es), 4, '2 términos × 2 intentos posibles');
assert.equal(fetchCost(latam), 4);

// 6) Lo declarado cubre el peor caso: si todo responde 429, no se gasta más de lo presupuestado.
{
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 429, headers: { 'retry-after': '0' } }); };
  await assert.rejects(() => sourceWorkable({ code: 'workable-es', locations: ['Spain'], terms: true, termsPerRun: 2 }), /ningún término respondió/);
  assert.equal(calls, fetchCost(es), 'los intentos no superan el coste declarado');
  globalThis.fetch = realFetch;
}

console.log('PASS  Workable: país por nombre, empresa aplanada, modalidad de `workplace`, ruido contado y caída solo si fallan todos los términos');
