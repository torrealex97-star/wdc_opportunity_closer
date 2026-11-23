// Salud por fuente: ¿está bien CONECTADA? No juzga rendimiento (eso es con 1.000 ofertas): solo dice si puede dar ofertas y, si no, por qué.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/sourcehealth.mjs
import assert from 'node:assert/strict';
const { classifySource, runSummary, BROKEN_AFTER } = await import('../../apps/web/lib/sourceHealth.ts');
const { failureText } = await import('../../apps/web/lib/apify.ts');
const { routesForCatalog } = await import('../../apps/web/lib/sourceRoutes.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };

const free = [{ id: 'x:engine', source: 'x', provider: 'engine', label: 'Feed', cost: 'free', costUsd: 0, stage: 0, evidence: 'operativo' }];
const paid = [{ id: 'x:apify', source: 'x', provider: 'apify', label: 'Apify', cost: 'paid', costUsd: null, stage: 5, evidence: 'documentado' }];
const run = (status, items, error = null) => ({ actor_id: 'a1', status, items, error, started_at: '2026-11-22T00:00:00Z' });
const base = { source: 'x', routes: free, ready: true, notReadyReason: '', actors: [], runs: [], seen: 10, drafts: 0 };

await step('Indeed hoy: 9 ejecuciones FAILED sin ninguna buena es «mal conectada» con la causa', () => {
  const runs = Array.from({ length: 9 }, () => run('FAILED', 0, 'La ejecución terminó como FAILED: No se pudo leer el esquema'));
  const h = classifySource({ ...base, routes: paid, actors: [{ id: 'a1', status: 'active', schedule_daily: false }], runs, seen: 0 });
  assert.equal(h.state, 'mal_conectada'); assert.match(h.cause, /esquema/); assert.match(h.next, /plantilla|esquema/i);
});

await step('Upwork hoy: ejecuciones correctas pero siempre 0 ítems es «mal conectada» (entrada mal hecha), no «conectada»', () => {
  const runs = Array.from({ length: 12 }, () => run('SUCCEEDED', 0));
  const h = classifySource({ ...base, routes: paid, actors: [{ id: 'a1', schedule_daily: true }], runs, seen: 0 });
  assert.equal(h.state, 'mal_conectada'); assert.match(h.cause, /0 ofertas/);
});

await step('una sola buena entre los fallos NO es mal conectada (no se condena por mala racha)', () => {
  const runs = [run('FAILED', 0), run('FAILED', 0), run('FAILED', 0), run('SUCCEEDED', 40)];
  assert.notEqual(classifySource({ ...base, routes: paid, actors: [{ id: 'a1' }], runs, seen: 40 }).state, 'mal_conectada');
  assert.equal(BROKEN_AFTER, 3);
  assert.notEqual(classifySource({ ...base, routes: paid, actors: [{ id: 'a1' }], runs: [run('FAILED', 0), run('FAILED', 0)] }).state, 'mal_conectada', 'con 2 fallos aún no');
});

await step('sin vía: catálogo sin ruta verificable se declara, nunca se inventa', () => {
  const h = classifySource({ ...base, routes: [], ready: false, seen: 0 });
  assert.equal(h.state, 'sin_via'); assert.match(h.cause, /Sin proveedor verificado/);
  const dead = classifySource({ ...base, routes: [{ ...free[0], evidence: 'bloqueado' }], ready: false });
  assert.equal(dead.state, 'sin_via', 'un feed caído tampoco cuenta como vía');
});

await step('falta clave: dice el motivo de la vía que no está lista', () => {
  const h = classifySource({ ...base, routes: paid, ready: false, notReadyReason: 'Sin clave de apify: no se intenta.', seen: 0 });
  assert.equal(h.state, 'sin_clave'); assert.match(h.cause, /Sin clave de apify/);
});

await step('sin programar: vía de pago lista, actor sin programación diaria y nunca ha recogido', () => {
  const h = classifySource({ ...base, routes: paid, actors: [{ id: 'a1', status: 'active', schedule_daily: false }], seen: 0, runs: [] });
  assert.equal(h.state, 'sin_programar');
  const scheduled = classifySource({ ...base, routes: paid, actors: [{ id: 'a1', schedule_daily: true }], seen: 0, runs: [] });
  assert.equal(scheduled.state, 'conectada');
});

await step('Recoge pero más de la mitad sigue en borrador (p. ej. 60 de 110) es «ofertas sin juzgar»; pocas ofertas no dispara la alerta', () => {
  assert.equal(classifySource({ ...base, routes: paid, actors: [{ id: 'a1', schedule_daily: true }], runs: [run('SUCCEEDED', 40)], seen: 110, drafts: 60 }).state, 'sin_juzgar');
  assert.equal(classifySource({ ...base, seen: 9, drafts: 9 }).state, 'conectada', 'con menos de 20 borradores no hay alarma');
  assert.equal(classifySource({ ...base, seen: 200, drafts: 40 }).state, 'conectada', 'si menos de la mitad está sin juzgar, no');
});

await step('un recuento caído (null) no inventa «sin juzgar» ni «conectada con 0»', () => {
  const h = classifySource({ ...base, seen: null, drafts: null });
  assert.equal(h.state, 'conectada'); assert.ok(!/0 de/.test(h.cause));
});

await step('actor retirado sin otra vía es «sin vía», con el motivo; con otra vía gratis no se condena la fuente', () => {
  assert.equal(classifySource({ ...base, routes: paid, actors: [{ id: 'a1', status: 'inactive' }], seen: 0 }).state, 'sin_via');
  assert.equal(classifySource({ ...base, routes: [...free, ...paid], actors: [{ id: 'a1', status: 'inactive' }] }).state, 'conectada');
});

await step('runSummary cuenta ok, fallos, ok vacías y guarda el último error', () => {
  const s = runSummary([run('FAILED', 0, 'motivo A'), run('SUCCEEDED', 0), run('SUCCEEDED', 5), run('TIMED-OUT', 0, 'motivo B')]);
  assert.deepEqual(s, { ok: 2, failed: 2, okZero: 1, lastError: 'motivo A' });
});

await step('Apify FAILED guarda el motivo real (statusMessage) en vez de solo «FAILED»', () => {
  assert.equal(failureText('FAILED', 'Input is not valid: field "searchTerms" is required'), 'La ejecución terminó como FAILED: Input is not valid: field "searchTerms" is required');
  assert.equal(failureText('FAILED'), 'La ejecución terminó como FAILED.');
  assert.ok(failureText('FAILED', 'x'.repeat(900)).length < 360, 'el texto se acota');
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
