// Fuentes gratuitas del motor (2026-11-24): lo que informa /api/funnel se traduce a «recogidas», «aprobadas» y conexión; un fallo se dice y un dato que falta es null.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/enginesources.mjs
import assert from 'node:assert/strict';
const { engineView, engineBySource, engineHealth } = await import('../../apps/web/lib/engineSources.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };

await step('engineView: números válidos, estado y causa; lo raro es null, no 0', () => {
  assert.deepEqual(engineView({ catalogo: 2791, revisadas: 290, elegible: 124, seleccionada: 3, run_status: 'completed' }), { catalog: 2791, reviewed: 290, eligible: 124, selected: 3, run_status: 'completed', cause: null });
  const odd = engineView({ catalogo: 'mucho', revisadas: -1, elegible: NaN, run_status: 'rara', fuente: '  HTTP 410  ' });
  assert.deepEqual(odd, { catalog: null, reviewed: null, eligible: null, selected: null, run_status: 'unknown', cause: 'HTTP 410' });
  assert.equal(engineView({ fuente: 'x'.repeat(500) }).cause.length, 200);
});
await step('engineBySource: por código; sin código o sin lista no se inventa nada', () => {
  const m = engineBySource({ sources: [{ code: 'freehire', catalogo: 5 }, { name: 'sin código' }, { code: '' }] });
  assert.deepEqual([...m.keys()], ['freehire']); assert.equal(m.get('freehire').catalog, 5);
  assert.equal(engineBySource(null).size, 0); assert.equal(engineBySource({ sources: null }).size, 0);
});
await step('el caso real de hoy: HTTP 410 y 429 son «mal conectada» con su causa y no se esconden', () => {
  const dead = engineHealth('jobtoday-closer-remoto', engineView({ catalogo: 1, revisadas: 0, run_status: 'failed', fuente: 'HTTP 410' }));
  assert.equal(dead.state, 'mal_conectada'); assert.match(dead.cause, /falló: HTTP 410/); assert.ok(dead.next.length > 10);
  const limited = engineHealth('himalayas-closer', engineView({ catalogo: 95, run_status: 'failed', fuente: 'ningún término respondió (remote closer: HTTP 429)' }));
  assert.equal(limited.state, 'mal_conectada'); assert.match(limited.cause, /429/);
});
await step('completada con catálogo vacío es «mal conectada» (Working Nomads: 0 en catálogo); sin informe de resultado se dice', () => {
  assert.equal(engineHealth('workingnomads', engineView({ revisadas: 0, run_status: 'completed' })).state, 'mal_conectada');
  assert.equal(engineHealth('x', engineView({ catalogo: 0, run_status: 'completed' })).state, 'mal_conectada');
  const unknown = engineHealth('x', engineView({ catalogo: 4 })); assert.equal(unknown.state, 'conectada'); assert.match(unknown.cause, /no informa/);
});
await step('recogiendo: dice cuánto revisó, cuántas son elegibles y seleccionadas, con puntos de millares y «—» si falta', () => {
  const h = engineHealth('freehire', engineView({ catalogo: 2791, revisadas: 1290, elegible: 124, seleccionada: 3, run_status: 'completed' }));
  assert.equal(h.state, 'conectada'); assert.match(h.cause, /1\.290 revisadas, 124 elegibles y 3 seleccionadas hoy/);
  assert.match(engineHealth('y', engineView({ catalogo: 5, run_status: 'completed' })).cause, /— revisadas, — elegibles y — seleccionadas/);
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
process.exit(failed ? 1 : 0);
