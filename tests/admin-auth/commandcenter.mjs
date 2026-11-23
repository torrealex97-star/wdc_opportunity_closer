// Centro de mando: coste por oferta aprobada y reparto gratuitas/de pago. Un hueco no es un cero.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/commandcenter.mjs
import assert from 'node:assert/strict';
const { costPerApproved, paidFreeSplit } = await import('../../apps/web/lib/commandCenter.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };

await step('coste por aprobada: se divide, redondea a céntimos y sin aprobadas, sin coste o sin dato es null (nunca 0 ni infinito)', () => {
  assert.equal(costPerApproved({ approved: 4, cost_usd: 2 }), 0.5);
  assert.equal(costPerApproved({ approved: 3, cost_usd: 1 }), 0.33);
  assert.equal(costPerApproved({ approved: 0, cost_usd: 2 }), null, 'sin aprobadas no se divide por cero');
  assert.equal(costPerApproved({ approved: null, cost_usd: 2 }), null);
  assert.equal(costPerApproved({ approved: 5, cost_usd: null }), null, 'sin coste registrado no hay coste por aprobada');
  assert.equal(costPerApproved({ approved: 5, cost_usd: 0 }), null, 'coste 0 no es un coste por aprobada');
});

await step('reparto: fuentes con coste > 0 son de pago, el resto gratuitas, con coste legible', () => {
  const rows = [{ source: 'apify-linkedin', seen: 100, approved: 10, cost_usd: 3 }, { source: 'jooble', seen: 900, approved: 90, cost_usd: null }, { source: 'infojobs', seen: 50, approved: 0, cost_usd: null }];
  const s = paidFreeSplit(rows, true);
  assert.deepEqual({ ...s }, { paid_approved: 10, free_approved: 90, paid_share: 10, unknown: 0 });
});

await step('sin coste legible no se reparte: no se inventa un porcentaje', () => {
  const s = paidFreeSplit([{ source: 'a', seen: 10, approved: 5, cost_usd: null }, { source: 'b', seen: 10, approved: 5, cost_usd: 2 }], false);
  assert.equal(s.paid_share, null); assert.equal(s.free_approved, 0); assert.equal(s.unknown, 5); assert.equal(s.paid_approved, 5);
});

await step('una fuente sin recuento de aprobadas (null) cuenta como «sin poder repartir», no como 0', () => {
  const s = paidFreeSplit([{ source: 'a', seen: null, approved: null, cost_usd: null }, { source: 'b', seen: 10, approved: 10, cost_usd: null }], true);
  assert.equal(s.unknown, 1); assert.equal(s.free_approved, 10); assert.equal(s.paid_share, 0);
});

await step('sin ninguna aprobada el porcentaje es null, no 0 %', () => {
  assert.equal(paidFreeSplit([{ source: 'a', seen: 5, approved: 0, cost_usd: null }], true).paid_share, null);
  assert.equal(paidFreeSplit([], true).paid_share, null);
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
