// Filtros de la vista de alumna: modalidad y prospección son ejes PROPIOS, separados del idioma.
// Antes la vista solo tenía «español / bilingüe» y una línea fija «remoto o híbrido»; pedir
// presencial no era posible y una oferta sin modalidad se servía igual. La prueba recorre
// `studentSurface` de verdad sobre un shim de D1 (mismas puertas y mismo ranking) y comprueba
// que cada filtro devuelve SOLO lo que el anuncio declara, nunca lo supuesto.
// Uso: node --experimental-strip-types tests/engine/filters.mjs   (sin red ni Cloudflare)
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-filters-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test: t } = await import(pathToFileURL(stage).href);

const BASE = 'Buscamos closer para cerrar ventas high ticket. Ofrecemos salario, comisiones y formación. Experiencia mínima de un año atendiendo clientes y cerrando operaciones.';
const row = (id, description, title = 'Closer de ventas', withBase = true) => ({
  job_id: id, starred: 0, source: 'test',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  payload: JSON.stringify({
    title, company: `Empresa ${id}`, location: 'Madrid, España', url: `https://x.test/${id}`,
    posted_at: new Date().toISOString(), raw: { description: withBase ? `${description} ${BASE}` : description },
  }),
});
const surface = (rows, opts = {}) => t.studentSurface(
  { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } },
  { role: null, market: 'any', days: 10, includeBilingual: false, starredOnly: false, includeExtraRoles: false, ...opts },
);
const ids = result => result.ranked.map(offer => offer.id);

const rows = [
  row('presencial', 'Puesto presencial en nuestra oficina de Madrid.'),
  row('remoto', 'Trabajo 100% remoto desde cualquier ciudad.'),
  row('hibrido', 'Modelo híbrido: dos días en oficina.'),
  row('sin-modalidad', 'Incorporación inmediata al equipo comercial.'),
];

// 1) Cada modalidad devuelve solo lo que la declara. Una oferta que no dice dónde se trabaja no
//    entra en «presencial» ni en «remoto»: sería una suposición, y de las caras.
assert.deepEqual(ids(await surface(rows, { modalityFilter: 'onsite' })), ['presencial']);
assert.deepEqual(ids(await surface(rows, { modalityFilter: 'remote' })), ['remoto']);
assert.deepEqual(ids(await surface(rows, { modalityFilter: 'hybrid' })), ['hibrido']);
assert.equal((await surface(rows)).ranked.length, 4, 'sin filtro se sirven las cuatro');

// 2) La modalidad que se enseña es la declarada, no «remoto salvo que diga híbrido».
const served = Object.fromEntries((await surface(rows)).ranked.map(offer => [offer.id, offer.modality]));
assert.deepEqual(served, {
  presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido', 'sin-modalidad': 'Modalidad no indicada',
});

// 3) Prospección: solo consta cuando el anuncio lo menciona; la negación cuenta al contrario.
const motionRows = [
  row('frio', 'Prospección en frío y llamadas en frío todos los días.'),
  row('entrantes', 'Trabajarás con leads entrantes cualificados; nada de llamadas en frío.'),
  row('sin-mencion', 'Te incorporas al equipo comercial con cartera propia.'),
];
assert.equal(t.salesMotionOf('sin llamadas en frío, solo leads entrantes'), 'inbound', 'la negación no es prospección en frío');
assert.equal(t.salesMotionOf('cold calling para generar tus propias oportunidades'), 'outbound');
assert.equal(t.salesMotionOf('te incorporas al equipo comercial'), null);
assert.deepEqual(ids(await surface(motionRows, { motionFilter: 'outbound' })), ['frio']);
assert.deepEqual(ids(await surface(motionRows, { motionFilter: 'inbound' })), ['entrantes']);
assert.equal((await surface(motionRows)).ranked.find(offer => offer.id === 'sin-mencion').sales_motion, null);

// 4) Los dos filtros se combinan con los de siempre sin cambiar el idioma: pedir presencial no
//    enciende el inglés ni relaja el mercado.
const result = await surface([
  row('presencial-es', 'Puesto presencial en nuestra oficina de Madrid.'),
  row('presencial-en', 'We are hiring an experienced closer for our Madrid office. On-site role with salary and commissions.', 'Closer', false),
], { modalityFilter: 'onsite' });
assert.deepEqual(ids(result), ['presencial-es'], 'el filtro de modalidad no abre la puerta del inglés');

console.log('PASS  modalidad y prospección filtran por lo declarado, con la negación bien leída');
