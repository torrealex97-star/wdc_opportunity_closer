// Muestra por fuente: con menos de 1.000 ofertas recogidas la lectura es «sin conclusión»; un hueco no es un cero.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/sourcesample.mjs
import assert from 'node:assert/strict';
const { sampleRow, SAMPLE_TARGET } = await import('../../apps/web/lib/sourceSample.ts');
const { fmtInt } = await import('../../apps/web/lib/formatInt.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };

await step('el objetivo es de 1.000 ofertas y se escribe con punto de millares', () => {
  assert.equal(SAMPLE_TARGET, 1000);
  assert.deepEqual([0, 7, 999, 1000, 12345, 1234567].map(fmtInt), ['0', '7', '999', '1.000', '12.345', '1.234.567']);
  assert.match(sampleRow({ source: 'a', seen: 0, approved: 0, cost_usd: null }).note, /Faltan 1\.000 /);
});

await step('999 recogidas: sin conclusión y faltan 1; 1.000: muestra suficiente', () => {
  const a = sampleRow({ source: 'apify-linkedin', seen: 999, approved: 1, cost_usd: 2 });
  assert.equal(a.state, 'sin_conclusion'); assert.equal(a.missing, 1); assert.match(a.note, /no se recorta/);
  const b = sampleRow({ source: 'apify-linkedin', seen: 1000, approved: 50, cost_usd: 2 });
  assert.equal(b.state, 'medida'); assert.equal(b.missing, 0);
});

await step('el caso real de hoy: LinkedIn 104 recogidas y 1 aprobada es «sin conclusión», no «rinde mal»', () => {
  const row = sampleRow({ source: 'apify-linkedin', seen: 104, approved: 1, cost_usd: 0.2162 });
  assert.equal(row.state, 'sin_conclusion'); assert.equal(row.missing, 896);
  assert.equal(row.approved_pct, 1); assert.equal(row.approved_per_usd, 4.63, 'el dato se enseña, pero con su etiqueta de muestra insuficiente');
});

await step('un hueco no es un cero: sin recuento, sin coste o con coste 0 salen en null, nunca 0', () => {
  const none = sampleRow({ source: 'x', seen: null, approved: null, cost_usd: null });
  assert.equal(none.state, 'sin_dato'); assert.equal(none.missing, null); assert.equal(none.approved_pct, null); assert.match(none.note, /no es cero/);
  const noCost = sampleRow({ source: 'jooble', seen: 300, approved: 100, cost_usd: null });
  assert.equal(noCost.approved_per_usd, null); assert.equal(noCost.approved_pct, 33.3);
  assert.equal(sampleRow({ source: 'jooble', seen: 300, approved: 100, cost_usd: 0 }).approved_per_usd, null, 'con coste 0 no se divide');
  const noApproved = sampleRow({ source: 'y', seen: 300, approved: null, cost_usd: 3 });
  assert.equal(noApproved.approved_pct, null); assert.equal(noApproved.approved_per_usd, null);
  const empty = sampleRow({ source: 'z', seen: 0, approved: 0, cost_usd: null });
  assert.equal(empty.state, 'sin_conclusion'); assert.equal(empty.approved_pct, null, 'sin recogidas no hay porcentaje');
});

await step('la fecha de corte se conserva para enseñarla', () => assert.equal(sampleRow({ source: 'a', seen: 5, approved: 0, cost_usd: null }, '2026-11-25T00:00:00Z').since, '2026-11-25T00:00:00Z'));

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
