// SmartRecruiters: búsqueda global sin clave (verificada 2026-11-20). Lo que se fija: que `keyword` sí
// filtra y `location` no (por eso se pide sin país), que la descripción sale del detalle público —sin
// ella el gate de idioma no publicaría nada—, que el detalle se paga solo hasta `detailBudget` y que lo
// que no cabe o falla se CUENTA en vez de ingerirse vacío.
// Uso: node --experimental-strip-types tests/engine/smartrecruiters.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const stage = join(mkdtempSync(join(tmpdir(), 'wdc-smartrecruiters-')), 'worker.mjs');
copyFileSync(fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url)), stage);
const worker = await import(pathToFileURL(stage).href);
const { sourceSmartRecruiters, SOURCES, fetchCost, filteredOf, filteredByReasonOf, resetExtractFiltered } = worker.__test;

// Respuesta real recortada (keyword=comercial, 2026-11-20). Las tres primeras son de España y la última
// de EE. UU.: el detalle se gasta primero en las hispanohablantes.
const SEARCH = {
  offset: 0, limit: 100, totalFound: 221,
  content: [
    {
      id: '13926704426', name: 'Comercial Junior (Temporal) - El Puerto de Santa María',
      company: { identifier: 'METROMAKRO', name: 'METRO/MAKRO' },
      releasedDate: '2026-11-19T08:00:00.000Z',
      location: { city: 'PUERTO DE SANTA MARIA, EL', region: null, country: 'es', remote: false, hybrid: false },
      actions: { details: 'https://api.smartrecruiters.com/v1/companies/METROMAKRO/postings/13926704426' },
      applyUrl: 'https://jobs.smartrecruiters.com/METROMAKRO/13926704426-comercial-junior',
      shortLocation: 'El Puerto de Santa María',
    },
    {
      id: '13917037610', name: 'Team Leader Comercial',
      company: { identifier: 'BoschGroup', name: 'Bosch Group' },
      releasedDate: '2026-11-18T08:00:00.000Z',
      location: { city: 'Vigo', region: 'Pontevedra', country: 'es', remote: true, hybrid: false },
      actions: { details: 'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/13917037610' },
      applyUrl: 'https://jobs.smartrecruiters.com/BoschGroup/13917037610-team-leader-comercial',
      shortLocation: 'Vigo',
    },
    {
      id: '13900000003', name: 'Recepcionista de hotel',
      company: { identifier: 'HotelCo', name: 'Hotel Co' },
      releasedDate: '2026-11-17T08:00:00.000Z',
      location: { city: 'Madrid', region: null, country: 'es', remote: false, hybrid: false },
      actions: { details: 'https://api.smartrecruiters.com/v1/companies/HotelCo/postings/13900000003' },
      applyUrl: 'https://jobs.smartrecruiters.com/HotelCo/13900000003-recepcionista',
      shortLocation: 'Madrid',
    },
    {
      id: '744000162635250', name: 'Closing Assistant Manager',
      company: { identifier: 'Dominos', name: "Domino's" },
      releasedDate: '2026-11-20T01:20:01.633Z',
      location: { city: 'Fayetteville', region: 'TN', country: 'us', remote: false, hybrid: false },
      actions: { details: 'https://api.smartrecruiters.com/v1/companies/Dominos/postings/744000162635250' },
      applyUrl: 'https://jobs.smartrecruiters.com/Dominos/744000162635250-closing-assistant',
      shortLocation: 'Fayetteville, TN',
    },
  ],
};

const DETAIL = company => ({
  id: 'x', name: 'Comercial Junior',
  jobAd: { sections: {
    companyDescription: { text: '<p>Hola, Hallo, Hello! ¿Quieres ser parte del equipo?</p>' },
    jobDescription: { text: '<p>Buscamos un/a <strong>Comercial Junior</strong> para ventas.</p>' },
    qualifications: { text: '<p>Experiencia comercial en ventas de al menos 1 año.</p>' },
    additionalInformation: { text: '<p>Te ofrecemos comisiones y formación.</p>' },
  } },
  _company: company,
});

const realFetch = globalThis.fetch;

try {
  // 1) Una búsqueda, un detalle por oferta del perfil y descripción completa desde las secciones.
  {
    const urls = [];
    globalThis.fetch = async url => {
      const u = String(url);
      urls.push(u);
      if (u.includes('/sr-jobs/search')) return new Response(JSON.stringify(SEARCH), { status: 200 });
      return new Response(JSON.stringify(DETAIL()), { status: 200 });
    };
    resetExtractFiltered();
    const rows = await sourceSmartRecruiters({ code: 'smartrecruiters', terms: true, termsPerRun: 1, detailBudget: 4 });
    assert.equal(urls.filter(u => u.includes('/sr-jobs/search')).length, 1, 'una búsqueda por término');
    assert.match(urls[0], /keyword=[^&]+&limit=100/);
    assert.ok(!/location=|country=/.test(urls[0]), 'no se pide país: la API no lo aplica');
    assert.equal(rows.length, 2, 'entran las dos ofertas comerciales; la recepcionista no');
    const first = rows.find(r => r.external_id === '13926704426');
    assert.equal(first.payload.company, 'METRO/MAKRO');
    assert.equal(first.payload.location, 'PUERTO DE SANTA MARIA, EL, es', 'ciudad y país de la fuente');
    assert.match(first.payload.raw.description, /Buscamos un\/a/, 'la descripción sale del detalle público');
    assert.match(first.payload.raw.description, /comisiones/, 'y suma todas las secciones');
    assert.equal(first.payload.url, 'https://jobs.smartrecruiters.com/METROMAKRO/13926704426-comercial-junior');
    assert.equal(first.payload.salary, null, 'sin salario estructurado no se inventa');
    assert.equal(first.payload.posted_at, '2026-11-19T08:00:00.000Z');
    const remote = rows.find(r => r.external_id === '13917037610');
    assert.match(remote.payload.location, /· remoto$/, 'la modalidad se declara desde el campo de la fuente');
    assert.ok(!rows.some(r => r.external_id === '744000162635250'), 'la de EE. UU. no entra: no hay detalle para ella y el perfil manda');
    assert.ok(filteredOf('smartrecruiters') >= 2, 'el ruido y lo que no cabe se cuentan');
  }

  // 2) El detalle se paga solo hasta el presupuesto: el resto se cuenta, no se ingiere vacío.
  {
    const detailCalls = [];
    globalThis.fetch = async url => {
      const u = String(url);
      if (u.includes('/sr-jobs/search')) return new Response(JSON.stringify(SEARCH), { status: 200 });
      detailCalls.push(u);
      return new Response(JSON.stringify(DETAIL()), { status: 200 });
    };
    resetExtractFiltered();
    const rows = await sourceSmartRecruiters({ code: 'smartrecruiters', terms: true, termsPerRun: 1, detailBudget: 1 });
    assert.equal(detailCalls.length, 1, 'un solo detalle con presupuesto 1');
    assert.equal(rows.length, 1);
    assert.equal(filteredByReasonOf('smartrecruiters').detalle_fuera_de_presupuesto, 1, 'lo que no cupo se declara');
  }

  // 3) Un detalle que falla no ingiere la oferta sin cuerpo: se cuenta como `sin_detalle`.
  {
    globalThis.fetch = async url => {
      const u = String(url);
      if (u.includes('/sr-jobs/search')) return new Response(JSON.stringify(SEARCH), { status: 200 });
      return new Response('{}', { status: 500 });
    };
    resetExtractFiltered();
    const rows = await sourceSmartRecruiters({ code: 'smartrecruiters', terms: true, termsPerRun: 1, detailBudget: 2 });
    assert.equal(rows.length, 0, 'sin descripción no hay oferta publicable');
    assert.equal(filteredByReasonOf('smartrecruiters').sin_detalle, 2);
  }

  // 3b) El orden del detalle usa el mercado que YA conoce el motor: Portugal no es mercado WDC (está en
  //     ISO_COUNTRIES pero no en LATAM_COUNTRIES), así que con presupuesto 1 el detalle va a la española
  //     aunque la portuguesa venga antes.
  {
    const PT_FIRST = { ...SEARCH, content: [
      { id: 'pt-1', name: 'Consultor Comercial', company: { identifier: 'PTCO', name: 'PT Co' },
        location: { city: 'Lisboa', country: 'pt', remote: false, hybrid: false },
        actions: { details: 'https://api.smartrecruiters.com/v1/companies/PTCO/postings/pt-1' },
        applyUrl: 'https://jobs.smartrecruiters.com/PTCO/pt-1', releasedDate: '2026-11-19T08:00:00.000Z' },
      ...SEARCH.content,
    ] };
    const detailCalls = [];
    globalThis.fetch = async url => {
      const u = String(url);
      if (u.includes('/sr-jobs/search')) return new Response(JSON.stringify(PT_FIRST), { status: 200 });
      detailCalls.push(u);
      return new Response(JSON.stringify(DETAIL()), { status: 200 });
    };
    await sourceSmartRecruiters({ code: 'smartrecruiters', terms: true, termsPerRun: 1, detailBudget: 1 });
    assert.equal(detailCalls.length, 1);
    assert.match(detailCalls[0], /METROMAKRO/, 'el detalle prioriza España/LATAM, no Portugal');
  }

  // 4) Si la búsqueda falla, la fuente se declara caída (no un vacío silencioso).
  {
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    await assert.rejects(() => sourceSmartRecruiters({ code: 'smartrecruiters', terms: true, termsPerRun: 1 }), /ningún término respondió/);
  }
} finally {
  globalThis.fetch = realFetch;
}

// 5) Declarada en el motor con su coste HONESTO: búsqueda con un reintento + 4 detalles sin reintento.
const source = SOURCES.find(s => s.code === 'smartrecruiters');
assert.ok(source, 'smartrecruiters está en SOURCES');
assert.equal(source.kind, 'smartrecruiters');
assert.equal(source.detailBudget, 4);
assert.equal(fetchCost(source), 6, 'coste declarado: 2 intentos de búsqueda + 4 detalles');

// 6) Lo declarado cubre el peor caso: un 429 repetido reintenta UNA vez y no pasa del presupuesto.
{
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 429, headers: { 'retry-after': '0' } }); };
  await assert.rejects(() => sourceSmartRecruiters({ code: 'smartrecruiters', terms: true, termsPerRun: 1 }), /ningún término respondió/);
  assert.equal(calls, 2, 'dos intentos de búsqueda (uno + un reintento)');
  assert.ok(calls <= fetchCost(source), 'los intentos no superan el coste declarado');
  globalThis.fetch = realFetch;
}

console.log('PASS  SmartRecruiters: keyword sí filtra y location no, descripción del detalle público, presupuesto de detalles declarado y caída sin vacío silencioso');
