// Desenlace de una ejecución de Apify en lenguaje llano: lo que ve quien pulsa «Probar ruta».
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/runoutcome.mjs
import assert from 'node:assert/strict';
const { describeRun, STUCK_AFTER_MIN } = await import('../../apps/web/lib/runOutcome.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const now = Date.parse('2026-11-24T10:00:00Z');
const run = (over = {}) => ({ status: 'SUCCEEDED', harvested: 10, cost_usd: 0.04, error: null, started_at: new Date(now - 3 * 60_000).toISOString(), finished_at: new Date(now - 60_000).toISOString(), ...over });

await step('sin ninguna ejecución no es un fallo ni un cero: se dice', () => {
  const o = describeRun(null, now); assert.equal(o.state, 'none'); assert.match(o.text, /Todavía no hay ninguna ejecución/);
});
await step('en marcha: se dice cuánto lleva y no se da por fallida', () => {
  const o = describeRun(run({ status: 'RUNNING', finished_at: null, harvested: 0, cost_usd: null }), now); assert.equal(o.state, 'running'); assert.match(o.text, /Ejecutándose en Apify \(hace 3 min\)/);
  assert.equal(describeRun(run({ finished_at: null }), now).state, 'running', 'terminó pero aún se recogen los resultados');
});
await step('una ejecución que lleva demasiado «en marcha» se declara posible atasco', () => {
  const o = describeRun(run({ status: 'RUNNING', finished_at: null, started_at: new Date(now - (STUCK_AFTER_MIN + 5) * 60_000).toISOString() }), now);
  assert.equal(o.state, 'failed'); assert.match(o.text, /puede haberse atascado/);
});
await step('recogió: dice cuántas y el coste', () => {
  const o = describeRun(run(), now); assert.equal(o.state, 'collected'); assert.match(o.text, /Recogió 10 oferta\(s\)\. Coste: 0,04 US\$/);
});
await step('terminó con 0 ofertas: es «sin ofertas» con el consejo, no «recogió 0»', () => {
  const o = describeRun(run({ harvested: 0 }), now); assert.equal(o.state, 'empty'); assert.match(o.text, /sin ofertas/); assert.match(o.text, /plantilla de entrada/);
});
await step('falló: enseña el motivo real (el statusMessage) sin el prefijo repetido', () => {
  const o = describeRun(run({ status: 'FAILED', harvested: 0, error: 'La ejecución terminó como FAILED: Input is not valid: field "position" is required' }), now);
  assert.equal(o.state, 'failed'); assert.equal(o.text, 'Falló: Input is not valid: field "position" is required. Coste: 0,04 US$.');
  assert.match(describeRun(run({ status: 'TIMED-OUT', error: null }), now).text, /Apify la dejó como TIMED-OUT, sin motivo registrado/);
});
await step('sin coste registrado no se escribe un coste', () => assert.doesNotMatch(describeRun(run({ cost_usd: null }), now).text, /Coste/));

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
