// openradar.fun: extractor sin red con una respuesta recortada del API real (2026-11-18). Lo que se
// fija: los campos que documenta su OpenAPI, el encargo que no se disfraza de salario, el remoto de
// LATAM cuya `city` viene en cirílico y que la fuente se declara caída solo si fallan TODOS los términos.
// Uso: node --experimental-strip-types tests/engine/openradar.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const stage = join(mkdtempSync(join(tmpdir(), 'wdc-openradar-')), 'worker.mjs');
copyFileSync(fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url)), stage);
const worker = await import(pathToFileURL(stage).href);
const { sourceOpenradar, SOURCES, fetchCost, filteredOf, resetExtractFiltered } = worker.__test;

// Respuesta real recortada a los campos del extractor (q=setter telefonico, 2026-11-18).
const LEADS = [
  {
    id: '2951d026-1773-44d4-aa6b-7696a7d05ea5', type: 'job',
    title: 'Sales Setter B2C – Admisiones & Desarrollo Comercial',
    author: 'rehiresolutions.com', city: 'Онлайн', url: 'https://jobs.ashbyhq.com/rehire/542b71ba',
    canonicalUrl: 'https://jobs.ashbyhq.com/rehire/542b71ba', rawSalary: null,
    publishedAt: '2026-11-11T22:35:11.009Z', isRemote: true, workplaceType: 'remote',
    text: 'Sales Setter B2C – Admisiones & Desarrollo Comercial\nCompany: rehiresolutions.com\nLocation: Colombia\n100% Remoto – LATAM',
  },
  {
    id: '27484296-82d1-4c22-9adb-e7f5294b3784', type: 'gig',
    title: 'U.S. Insurance Agent Appointment Setter',
    city: null, url: 'https://www.freelancer.com/projects/account-management/Insurance-Agent-Appointment-Setter.html',
    rawSalary: '250 USD', publishedAt: '2026-11-17T02:41:40.000Z', isRemote: true, workplaceType: 'remote',
    text: 'U.S.-Based Cold Caller and Appointment Setter for Insurance Agent Partnerships',
  },
  {
    id: '1d96f440-ef01-45c6-ad5f-c4c9d1a0e8e1', type: 'job',
    title: 'Collaboratore commerciale', author: 'GP Creator Studio', city: 'Fidenza',
    url: 'https://jobboard.agilefluent.ru/jobs/29655845-collaboratore-commerciale',
    publishedAt: '2026-11-17T17:03:55.390Z', isRemote: false, workplaceType: 'onsite',
    text: 'RICERCHIAMO COLLABORATORI COMMERCIALI',
  },
];

const realFetch = globalThis.fetch;
try {
  // 1) Los campos que documenta el OpenAPI: título, autor, url, texto, fecha y modalidad.
  {
    let calls = 0;
    const urls = [];
    globalThis.fetch = async url => {
      calls++; urls.push(String(url));
      return new Response(JSON.stringify(LEADS), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    resetExtractFiltered();
    const rows = await sourceOpenradar({ code: 'openradar', terms: true, termsPerRun: 1 });
    assert.equal(calls, 1, 'un término, una petición');
    assert.match(urls[0], /openradar\.fun\/api\/leads\?q=.+&limit=50/);
    assert.equal(rows.length, 2, 'el setter español y el encargo; el italiano no tiene perfil');
    const setter = rows.find(r => r.payload.title.startsWith('Sales Setter'));
    assert.equal(setter.payload.company, 'rehiresolutions.com', '`author` es la empresa cuando viene');
    assert.equal(setter.payload.location, null, 'una ciudad en cirílico («Онлайн») no se publica como ubicación');
    assert.equal(setter.payload.salary, null, 'sin importe estructurado no se inventa nómina');
    assert.equal(setter.payload.posted_at, '2026-11-11T22:35:11.009Z');
    assert.match(setter.payload.raw.description, /Location: Colombia/, 'el texto completo queda como cuerpo');
    assert.ok(typeof setter.payload.raw.search_term === 'string' && setter.payload.raw.search_term.length, 'se declara con qué término se encontró');
    assert.ok(filteredOf('openradar') >= 1, 'el ruido se cuenta, no se esconde');
    const gig = rows.find(r => r.payload.title.includes('Appointment Setter'));
    assert.equal(gig.payload.salary, null, 'un encargo no se disfraza de salario');
    assert.equal(gig.payload.raw.rawSalary, '250 USD', 'el presupuesto queda en raw, sin perderlo');
    assert.equal(gig.payload.raw.engagement, 'freelance');
    assert.ok(rows.every(r => /^https:\/\//.test(r.payload.url)), 'todas las URL son absolutas');
  }

  // 2) Dos términos que devuelven el mismo lead no lo duplican.
  {
    globalThis.fetch = async () => new Response(JSON.stringify(LEADS), { status: 200 });
    const rows = await sourceOpenradar({ code: 'openradar', terms: true, termsPerRun: 2 });
    assert.equal(rows.length, 2, 'el dedupe es por id dentro de la fuente');
  }

  // 3) Un término que falla no tumba la fuente; si fallan todos, se declara caída con el motivo.
  {
    let n = 0;
    globalThis.fetch = async () => { n++; return n === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(LEADS), { status: 200 }); };
    assert.ok((await sourceOpenradar({ code: 'openradar', terms: true, termsPerRun: 2 })).length > 0, 'lo bueno del segundo término se conserva');
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    await assert.rejects(() => sourceOpenradar({ code: 'openradar', terms: true, termsPerRun: 2 }), /ningún término respondió/);
  }
} finally {
  globalThis.fetch = realFetch;
}

// 4) Declarada en el motor con su coste: 3 términos = 3 peticiones (rotan por día).
const source = SOURCES.find(s => s.code === 'openradar');
assert.ok(source, 'openradar está en SOURCES');
assert.equal(source.kind, 'openradar');
assert.equal(fetchCost(source), 3);

console.log('PASS  openradar: campos del OpenAPI, encargo sin salario, ubicación cirílica descartada y caída solo si fallan todos los términos');
