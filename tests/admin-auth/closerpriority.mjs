// El objetivo diario y el reparto del gasto cuentan SOLO closer, setter, cold caller y SDR (no «ejecutivo comercial» genérico), y el gasto
// del mes se reparte por días en vez de gastarse en los primeros. Medido el 2026-11-26: 708 de ~1.800 ofertas de la semana eran «ejecutivo
// comercial» y llenaban el objetivo, así que el cron paraba antes de buscar closers.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/closerpriority.mjs
import assert from 'node:assert/strict';
import { CORE_ROLES, CORE_ROLE_FILTER, dailyLimit } from '../../apps/web/lib/spendPlan.ts';

let passed = 0, failed = 0;
const step = (name, fn) => { try { fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };

step('los roles que cuentan son los de la academia, y el comercial genérico y los mandos no', () => {
  assert.deepEqual([...CORE_ROLES], ['closer', 'setter', 'cold_caller', 'sdr']);
  assert.equal(CORE_ROLE_FILTER, 'role=in.(closer,setter,cold_caller,sdr)');
  assert.ok(!CORE_ROLES.includes('account_executive') && !CORE_ROLES.includes('management'));
});

const at = (iso) => new Date(iso);
step('ritmo diario: lo que queda del mes entre los días que quedan (hoy incluido)', () => {
  // 26-nov: quedan 5 días (26..30); gastado 3,60 y nada hoy → 6,40 / 5 = 1,28 de hoy.
  assert.equal(dailyLimit(10, 3.6, 0, at('2026-11-26T06:00:00Z')), 4.88);
  // Ya se gastó 1 hoy (antes de hoy: 2,6): permiso de hoy = (10 − 2,6) / 5 = 1,48 → límite 4,08; quedan 0,48 por gastar hoy.
  assert.equal(dailyLimit(10, 3.6, 1, at('2026-11-26T09:00:00Z')), 4.08);
});
step('ritmo diario: el primer día del mes reparte el límite entre los 30 días', () => {
  assert.equal(dailyLimit(10, 0, 0, at('2026-11-01T06:00:00Z')), 0.33);
});
step('ritmo diario: nunca supera el límite mensual ni da negativos', () => {
  assert.equal(dailyLimit(10, 10, 0, at('2026-11-30T06:00:00Z')), 10, 'gastado todo: el límite efectivo es lo ya gastado, sin margen');
  assert.ok(dailyLimit(10, 12, 0, at('2026-11-30T06:00:00Z')) <= 12);
  assert.equal(dailyLimit(10, 9.9, 0, at('2026-11-30T06:00:00Z')), 10, 'el último día solo queda lo que queda');
});
step('ritmo diario: gasto de hoy mayor que el permiso no deja margen para más hoy', () => {
  const eff = dailyLimit(10, 5, 4, at('2026-11-26T12:00:00Z')); // antes de hoy: 1 → permiso 9/5=1,8 → 1+1,8=2,8 < 5 gastado
  assert.ok(eff <= 5, `sin margen: ${eff}`);
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
