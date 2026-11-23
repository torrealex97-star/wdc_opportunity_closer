// Tipo de fuente del Motor de fuentes: de pago, gratuitas o empresas. Pura.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/sourcekinds.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { kindOf } = await import('../../apps/web/lib/sourceKinds.ts');
const { routesForCatalog } = await import('../../apps/web/lib/sourceRoutes.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const catalog = JSON.parse(readFileSync(new URL('../../apps/web/lib/sourceCatalog.json', import.meta.url), 'utf8'));
const routes = routesForCatalog(catalog);
const kind = code => kindOf(catalog.find(e => e.code === code), routes.get(code));

await step('los ATS y las páginas de empresa son «empresas»', () => { for (const c of ['ats-greenhouse-stripe', 'ats-ashby-qonto', 'company']) assert.equal(kind(c), 'empresas', c); });
await step('los feeds del motor y las APIs oficiales son «gratuitas»', () => { for (const c of ['himalayas', 'remoteok', 'jobtoday', 'infojobs', 'jooble']) assert.equal(kind(c), 'gratuitas', c); });
await step('lo que solo se consigue pagando es «de pago»: Apify, Google Jobs de pago, marketplaces freelance', () => { for (const c of ['upwork', 'workana', 'linkedin', 'indeed', 'malt']) assert.equal(kind(c), 'pago', c); });
await step('todas las fuentes del catálogo caen en un tipo y los tres tipos suman el total', () => {
  const counts = { pago: 0, gratuitas: 0, empresas: 0 };
  for (const e of catalog) { const k = kind(e.code); assert.ok(k in counts, e.code); counts[k]++; }
  assert.equal(counts.pago + counts.gratuitas + counts.empresas, catalog.length); assert.ok(counts.pago > 0 && counts.gratuitas > 0 && counts.empresas > 0);
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
