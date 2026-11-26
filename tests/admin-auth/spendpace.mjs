// Reparto del gasto de Apify por días con el coste ESPERADO medido de cada portal. El reparto anterior dividía lo que queda entre TODOS los
// portales pendientes y exigía 0,5 USD por búsqueda: con ~1,28 USD al día y ~15 portales aplazaba todos (visto en CI). Sin red.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/spendpace.mjs
import assert from 'node:assert/strict';
import { paceRoutes, expectedRunCost, DEFAULT_EXPECTED_RUN_USD } from '../../apps/web/lib/spendPlan.ts';

let passed = 0, failed = 0;
const step = (name, fn) => { try { fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const at = iso => new Date(iso);
const route = (code, per, usd) => ({ code, qualified_per_usd: per, expected_usd: usd });
const base = { limitUsd: 10, spentMonthUsd: 3.6, spentTodayUsd: 0, now: at('2026-11-26T06:00:00Z'), runCapUsd: 2 };

step('permiso de hoy = lo que queda del mes entre los días que quedan (26-nov: 5 días → 1,28 USD)', () => {
  const p = paceRoutes({ ...base, routes: [] });
  assert.equal(p.allowance_usd, 1.28); assert.equal(p.remaining_today_usd, 1.28);
});
step('lanza por rendimiento mientras el coste ESPERADO quepa; el resto se aplaza con su motivo (no se aplaza todo)', () => {
  const p = paceRoutes({ ...base, routes: [route('indeed', 8, 0.89), route('infojobs', 20, 0.03), route('linkedin', 2, 0.35), route('jooble', 5, 0.04)] });
  assert.deepEqual(p.order, ['infojobs', 'indeed', 'jooble'], 'por aprobadas por dólar: infojobs 20, indeed 8, jooble 5 (0,03+0,89+0,04 caben en 1,28)');
  assert.deepEqual(p.deferred.map(d => d.code), ['linkedin'], 'linkedin (0,35) ya no cabe: 1,28−0,96=0,32');
  assert.match(p.deferred[0].reason, /0\.32 USD/); assert.match(p.deferred[0].reason, /mañana/);
});
step('la ejecución nunca queda con un tope por debajo del mínimo útil ni por encima del tope de ejecución', () => {
  const p = paceRoutes({ ...base, routes: [route('a', 5, 0.1)] });
  assert.ok(p.caps.a >= 0.5 && p.caps.a <= 2, `cap ${p.caps.a}`);
});
step('sin coste medido se supone el valor por defecto y se declara (no se finge medición)', () => {
  const p = paceRoutes({ ...base, routes: [route('nuevo', null, null)] });
  assert.deepEqual(p.assumed, ['nuevo']); assert.equal(DEFAULT_EXPECTED_RUN_USD, 0.25); assert.deepEqual(p.order, ['nuevo']);
});
step('sin rendimiento medido va al final, en el orden dado', () => {
  const p = paceRoutes({ ...base, limitUsd: 100, routes: [route('x', null, 0.1), route('y', 3, 0.1), route('z', null, 0.1)] });
  assert.deepEqual(p.order, ['y', 'x', 'z']);
});
step('lo ya gastado hoy se descuenta del permiso de hoy; si ya se pasó, no se lanza nada más hoy', () => {
  const some = paceRoutes({ ...base, spentMonthUsd: 3.6, spentTodayUsd: 1, routes: [route('a', 1, 0.3)] });
  assert.equal(some.remaining_today_usd, 0.48); assert.deepEqual(some.order, ['a']);
  const none = paceRoutes({ ...base, spentMonthUsd: 5.6, spentTodayUsd: 2, routes: [route('a', 1, 0.3)] });
  assert.equal(none.remaining_today_usd, 0); assert.deepEqual(none.order, []); assert.equal(none.deferred.length, 1);
});
step('nunca pasa del límite mensual aunque el permiso diario sea mayor; el último día solo queda lo que queda', () => {
  const p = paceRoutes({ ...base, spentMonthUsd: 9.9, now: at('2026-11-30T06:00:00Z'), routes: [route('a', 1, 0.25)] });
  assert.equal(p.remaining_today_usd, 0.1); assert.deepEqual(p.order, []);
  assert.equal(paceRoutes({ ...base, spentMonthUsd: 11, routes: [route('a', 1, 0.1)] }).order.length, 0, 'gastado de más: nada');
});
step('primer día del mes: el límite se reparte entre los 30 días', () => {
  assert.equal(paceRoutes({ ...base, spentMonthUsd: 0, now: at('2026-11-01T06:00:00Z'), routes: [] }).allowance_usd, 0.33);
});
step('una gasto de hoy desconocido (null) no se lanza nada: un hueco no es un cero', () => {
  const p = paceRoutes({ ...base, spentMonthUsd: null, routes: [route('a', 1, 0.1)] });
  assert.deepEqual(p.order, []); assert.match(p.deferred[0].reason, /no se pudo leer/);
});
step('coste esperado: media de las ejecuciones cerradas con coste; sin ninguna es null', () => {
  const runs = [{ cost_usd: 0.2, status: 'SUCCEEDED', finished_at: 'x' }, { cost_usd: 0.4, status: 'SUCCEEDED', finished_at: 'x' }, { cost_usd: null, status: 'FAILED', finished_at: 'x' }, { cost_usd: 1, status: 'RUNNING', finished_at: null }];
  assert.equal(expectedRunCost(runs), 0.3); assert.equal(expectedRunCost([]), null); assert.equal(expectedRunCost([{ cost_usd: 0, status: 'SUCCEEDED', finished_at: 'x' }]), null);
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
