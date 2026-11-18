// Orden de la vista de alumna: España primero y, dentro de eso, puntuación, frescura y
// prioridad de perfil. La prueba recorre `studentSurface` de verdad (mismo SQL y mismas
// puertas) sobre un shim de D1: con el comparador viejo —que devolvía `[qa.es - qb.es, …][0]`
// y solo aplicaba el primer criterio— el resultado era el orden de inserción del catálogo.
// Uso: node --experimental-strip-types tests/engine/rankorder.mjs   (sin red ni Cloudflare)
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-rank-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test: t } = await import(pathToFileURL(stage).href);

const CLOSER_TEXT = 'Buscamos closer para cerrar ventas high ticket por videollamada. Ofrecemos salario, comisiones y formación. Experiencia mínima de un año atendiendo clientes y cerrando operaciones.';
const COLD_TEXT = 'Buscamos teleoperador para llamadas en frío. Ofrecemos jornada completa, comisiones y formación. Experiencia previa atendiendo clientes por teléfono y gestionando agendas.';
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString();

const row = (id, { title, description = CLOSER_TEXT, location = 'Madrid, España', posted_at, salary }) => ({
  job_id: id, starred: 0, source: 'test',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  payload: JSON.stringify({
    title, company: `Empresa ${id}`, location, url: `https://x.test/${id}`, posted_at,
    ...(salary ? { salary } : {}), raw: { description },
  }),
});
const surface = (rows, opts = {}) => t.studentSurface(
  { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } },
  { role: null, market: 'any', days: 10, includeBilingual: false, starredOnly: false, includeExtraRoles: false, ...opts },
);
const ids = result => result.ranked.map(offer => offer.id);

// 1) Puntuación y frescura manda dentro del mismo mercado: la más puntuada y reciente
//    primero, aunque el catálogo la devuelva la última. Puntuación = título del perfil (50)
//    + frescura (20 si <= 3 días) + salario publicado (1).
{
  const result = await surface([
    row('vieja', { title: 'Closer de ventas vieja', posted_at: daysAgo(9) }),
    row('media', { title: 'Closer de ventas media', posted_at: daysAgo(5), salary: '30.000 €' }),
    row('fresca', { title: 'Closer de ventas fresca', posted_at: daysAgo(1), salary: '32.000 €' }),
  ]);
  assert.deepEqual(ids(result), ['fresca', 'media', 'vieja'],
    'sin puntuación ni frescura, el orden sería el de inserción del catálogo');
}

// 2) Con puntuación y fecha empatadas, decide la prioridad de perfil: closer antes que
//    cold caller. Se inserta al revés a propósito.
{
  const result = await surface([
    row('teleoperador', { title: 'Teleoperador de ventas', description: COLD_TEXT, posted_at: daysAgo(4) }),
    row('closer', { title: 'Closer de ventas', posted_at: daysAgo(4) }),
  ]);
  assert.deepEqual(ids(result), ['closer', 'teleoperador'],
    'a igualdad de score y fecha, el perfil closer va primero');
}

// 3) España sigue siendo el primer criterio: no se cambia esa regla al arreglar el resto.
{
  const result = await surface([
    row('latam', { title: 'Closer de ventas LatAm', location: 'Bogotá, Colombia', posted_at: daysAgo(1), salary: '3.000 €' }),
    row('espana', { title: 'Closer de ventas España', posted_at: daysAgo(9) }),
  ]);
  assert.deepEqual(ids(result), ['espana', 'latam'], 'España primero aunque la otra puntúe más');
}

// 4) El comparador nunca devuelve NaN con un perfil que no está en ROLE_PRIORITY (un NaN
//    en el comparador deja el orden a merced del motor, sin fallar).
{
  const cmp = (qa, qb) => t.compareStudentRank({ id: 'a' }, { id: 'b' }, { a: qa, b: qb });
  const base = { es: 0, score: 10, published_ts: 1000 };
  assert.equal(cmp({ ...base, role: 'closer' }, { ...base, role: 'setter' }) < 0, true);
  assert.equal(cmp({ ...base, role: 'desconocido' }, { ...base, role: 'closer' }) > 0, true,
    'un perfil fuera de la tabla va al final, no produce NaN');
  assert.equal(cmp(base, { ...base, es: 1 }) < 0, true, 'España (0) antes que fuera (1)');
  assert.equal(cmp({ ...base, score: 5 }, { ...base, score: 9 }) > 0, true, 'más score primero');
  assert.equal(cmp({ ...base, published_ts: 500 }, { ...base, published_ts: 900 }) > 0, true, 'más reciente primero');
}

// 5) Guardia de fuente: el comparador se usa en el sort y no vuelve el patrón que leía `[0]`.
{
  const source = readFileSync(workerPath, 'utf8');
  assert.match(source, /\.sort\(\(a, b\) => compareStudentRank\(a, b, quality\)\)/,
    'el sort de la superficie usa el comparador');
  assert.doesNotMatch(source, /\bqa\.es - qb\.es\b[\s\S]{0,200}\]\[0\]/,
    'nada de arrays de criterios con `[0]`: eso aplica solo el primero');
}

console.log('rankorder: OK');
