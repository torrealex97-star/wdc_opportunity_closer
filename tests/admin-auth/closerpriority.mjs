// El objetivo diario y el reparto del gasto cuentan SOLO closer, setter, cold caller y SDR (no «ejecutivo comercial» genérico), 
// Medido el 2026-11-26: 708 de ~1.800 ofertas de la semana eran «ejecutivo
// comercial» y llenaban el objetivo, así que el cron paraba antes de buscar closers.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/closerpriority.mjs
import assert from 'node:assert/strict';
import { CORE_ROLES, CORE_ROLE_FILTER } from '../../apps/web/lib/spendPlan.ts';

let passed = 0, failed = 0;
const step = (name, fn) => { try { fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };

step('los roles que cuentan son los de la academia, y el comercial genérico y los mandos no', () => {
  assert.deepEqual([...CORE_ROLES], ['closer', 'setter', 'cold_caller', 'sdr']);
  assert.equal(CORE_ROLE_FILTER, 'role=in.(closer,setter,cold_caller,sdr)');
  assert.ok(!CORE_ROLES.includes('account_executive') && !CORE_ROLES.includes('management'));
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
