// Mínimo diario por fuente y tope global: que cada fuente conectada corra algo cada día (para acumular muestra) sin pasar del tope.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/spendfloor.mjs
import assert from 'node:assert/strict';
const { DEFAULT_GLOBAL_CAP_USD, FLOOR_HOURS, FLOOR_LIMITS, floorDue, globalCapUsd, globalCheck, lastRanByStage, parseStageNote, stageNote } = await import('../../apps/web/lib/spendFloor.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const H = 3600_000, now = Date.parse('2026-11-24T10:00:00Z');
const row = (id, ran, hoursAgo) => ({ note: stageNote(id, ran, 'x'), created_at: new Date(now - hoursAgo * H).toISOString() });

await step('tope global: defecto 30, el entorno lo cambia y un valor malo nunca deja sin tope', () => {
  assert.equal(DEFAULT_GLOBAL_CAP_USD, 30);
  assert.equal(globalCapUsd({}), 30); assert.equal(globalCapUsd({ GLOBAL_PAID_CAP_USD: '80' }), 80);
  for (const bad of ['0', '-5', 'abc', '']) assert.equal(globalCapUsd({ GLOBAL_PAID_CAP_USD: bad }), 30, `valor ${bad}`);
});

await step('tope global suma todos los proveedores incluido Apify y para al llegar', () => {
  assert.equal(globalCheck([10, 5, 20, 1.5], 50, 1).ok, true);
  const over = globalCheck([20, 20, 9.5], 50, 1); assert.equal(over.ok, false); assert.match(over.reason, /Tope global/); assert.equal(over.spent, 49.5);
  assert.equal(globalCheck([49, 0], 50, 1).ok, true, 'justo en el tope todavía cabe');
});

await step('un gasto ilegible (null) no es cero: no se gasta', () => {
  const unknown = globalCheck([10, null, 5], 50, 0.01);
  assert.equal(unknown.ok, false); assert.equal(unknown.spent, null); assert.match(unknown.reason, /No se pudo leer/);
});

await step('el registro de etapas se escribe y se lee de vuelta', () => {
  assert.deepEqual(parseStageNote(stageNote('google-jobs', true, 'Recogida hecha.')), { id: 'google-jobs', ran: true });
  assert.deepEqual(parseStageNote(stageNote('apify', false, 'Objetivo del día cumplido')), { id: 'apify', ran: false });
  assert.equal(parseStageNote('proveedor=serpapi · coste_usd=0.025'), null, 'una nota de gasto no es una etapa');
  assert.equal(parseStageNote(null), null);
});

await step('mínimo diario: corre si no hubo ejecución buena en 20 h; una saltada no cuenta como corrida', () => {
  const history = lastRanByStage([row('google-jobs', true, 5), row('rapidapi', true, 30), row('respaldo', false, 1)]);
  assert.equal(FLOOR_HOURS, 20);
  assert.equal(floorDue('google-jobs', history, now), false, 'corrió hace 5 h');
  assert.equal(floorDue('rapidapi', history, now), true, 'corrió hace 30 h');
  assert.equal(floorDue('respaldo', history, now), true, 'solo constan saltadas: nunca corrió');
  assert.equal(floorDue('apify', history, now), true, 'sin ninguna anotación toca');
});

await step('última ejecución por etapa: gana la más reciente', () => {
  const history = lastRanByStage([row('apify', true, 40), row('apify', true, 3), row('apify', true, 25)]);
  assert.equal(history.get('apify'), new Date(now - 3 * H).toISOString());
});

await step('sin poder leer el registro no toca el mínimo (sin saber si ya corrió hoy no se gasta)', () => {
  assert.equal(floorDue('google-jobs', null, now), false);
});

await step('los mínimos son pequeños: 3 dorks, 1 petición de RapidAPI, 1 búsqueda de respaldo', () => {
  assert.deepEqual({ ...FLOOR_LIMITS }, { googleDorks: 3, rapidapiRequests: 1, fallbackSearches: 1 });
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
