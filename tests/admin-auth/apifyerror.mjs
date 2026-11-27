// Cuando Apify rechaza lanzar una ejecución (401/403) el motivo REAL de su respuesta llega al registro del cron: antes todo era «rechazó la clave»
// aunque la clave estuviera bien (2026-11-27: 14 portales sin arrancar, última prueba de la clave el 2026-10-16) y no se podía distinguir de un límite de uso.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/apifyerror.mjs
import assert from 'node:assert/strict';
import { apifyRejection } from '../../apps/web/lib/apifyErrors.ts';
import { apifyStageWhy } from '../../apps/web/lib/spendFloor.ts';

let passed = 0, failed = 0;
const step = (name, fn) => { try { fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };

step('401 es la clave; 403 cuenta lo que Apify dijo (tipo y mensaje) sin culpar a la clave', () => {
  assert.match(apifyRejection(401, { error: { type: 'user-or-token-not-found', message: 'User was not found or authentication token is not valid' } }), /^Apify rechazó la clave \(HTTP 401: user-or-token-not-found\)/);
  const limit = apifyRejection(403, { error: { type: 'platform-feature-disabled', message: 'Monthly usage hard limit exceeded. Raise the limit in Settings → Billing.' } });
  assert.match(limit, /HTTP 403/); assert.match(limit, /platform-feature-disabled/); assert.match(limit, /Monthly usage hard limit exceeded/);
  assert.doesNotMatch(limit, /rechazó la clave/, 'un 403 no se presenta como clave mala: puede ser límite, saldo o permisos');
});
step('sin cuerpo legible se dice, no se inventa una causa', () => {
  assert.match(apifyRejection(403, null), /HTTP 403.*sin detalle/);
  assert.match(apifyRejection(403, 'texto plano'), /HTTP 403.*sin detalle/);
  assert.match(apifyRejection(500, { error: { type: 'x', message: 'y' } }), /^Apify respondió HTTP 500/);
});
step('el detalle va acotado y limpio (una línea, sin secretos ni HTML)', () => {
  const out = apifyRejection(403, { error: { type: 'a', message: `línea 1\n<script>x</script> token apify_api_ABCDEF1234567890 ${'z'.repeat(400)}` } });
  assert.ok(out.length <= 220, `demasiado largo: ${out.length}`); assert.ok(!/\n|<script>/.test(out)); assert.ok(!/apify_api_ABCDEF/.test(out));
});
step('el registro del cron dice la causa común una vez, no la repite por portal', () => {
  const err = 'Apify rechazó la ejecución (HTTP 403: platform-feature-disabled · Monthly usage hard limit exceeded).';
  const why = apifyStageWhy(Array.from({ length: 14 }, (_, i) => ({ actor: `a/p${i}`, ok: false, error: err })));
  assert.match(why, /^0 de 14 arrancó\. No arrancaron 14 por la misma causa/); assert.match(why, /Monthly usage hard limit exceeded/);
  assert.ok(why.length <= 240, `${why.length}`);
});
step('causas distintas se siguen listando por portal', () => {
  const why = apifyStageWhy([{ actor: 'a/x', ok: false, error: 'Aplazada: sin saldo del mes.' }, { actor: 'a/y', ok: false, error: 'Sin tiempo en el presupuesto del cron.' }]);
  assert.match(why, /a\/x: Aplazada/); assert.match(why, /a\/y: Sin tiempo/);
});
console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
