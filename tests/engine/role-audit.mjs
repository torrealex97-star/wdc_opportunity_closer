// La métrica del informe de rol (`scripts/role-audit.mjs`) mide con la vista de la alumna, no con el
// gate de ingesta. El fallo que este test fija: `discardReason` corre con el perfil de la pasada y
// marca `familia_extra` a un account executive real, así que el informe decía «0 AE visibles en
// España» — falso. Con `studentSurface` el AE aparece.
// Uso: node --experimental-strip-types tests/engine/role-audit.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shimFor, viewOf } from '../../scripts/role-audit.mjs';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-role-audit-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test: t } = await import(pathToFileURL(stage).href);

const spanishBody = 'Buscamos persona para el equipo comercial en Madrid. Jornada completa, salario base más comisión y formación incluida desde el primer día.';
const rows = [
  { source: 'jobtoday', title: 'Closer de ventas', location: 'Madrid, España', body: spanishBody },
  { source: 'freehire', title: 'Account Executive', location: 'Barcelona, España', body: spanishBody },
  { source: 'freehire-latam', title: 'Account Executive', location: 'Barcelona, España', body: spanishBody }, // el mismo anuncio, replicado
  { source: 'freehire-latam', title: 'Sales Development Representative', location: 'Lima, Perú', body: spanishBody },
  { source: 'freehire', title: 'Account Executive', location: 'London, UK', body: spanishBody },
  { source: 'jobtoday', title: 'Ingeniero de software', location: 'Madrid, España', body: 'Buscamos ingeniero backend para el equipo de plataforma. Jornada completa y formación. Experiencia con servicios distribuidos y clientes internos.' },
  { source: 'arbeitnow', title: 'Account Executive', location: 'Madrid, España', body: 'We are looking for an account executive to close deals with our clients in the US. Full time, commissions and training.' },
];

// El AE ya entra por el gate de ingesta (sesión 209); la vista sigue siendo la que decide visibilidad.
const aePayload = { title: 'Account Executive', location: 'Barcelona, España', url: 'https://x.test/ae', raw: { description: spanishBody } };
assert.equal(t.discardReason(aePayload), null, 'el gate de ingesta ya no descarta el AE');

const es = await viewOf(t, rows, { market: 'ES' });
const esTitles = [...es.titles];
assert.ok(esTitles.includes('account executive'), 'AE aparece en la vista de España');
assert.ok(esTitles.includes('closer de ventas'), 'el closer también');
assert.ok(!esTitles.includes('sales development representative'), 'una oferta de Lima no entra en el mercado España');
assert.ok(!esTitles.includes('ingeniero de software'), 'una oferta no comercial no entra');
assert.equal(esTitles.filter(title => title === 'account executive').length, 1, 'el AE replicado entre fuentes cuenta una sola vez');
assert.equal(esTitles.filter(title => title === 'account executive').length, 1, 'y no se duplica en el recuento por familia');

const esFamilies = {};
for (const card of es.cards) esFamilies[card.role] = (esFamilies[card.role] ?? 0) + 1;
assert.equal(esFamilies.account_executive, 1, 'la familia account_executive se cuenta en la vista de España');
assert.equal(esFamilies.closer, 1, 'y el closer');
assert.equal(es.cards.find(card => card.role === 'account_executive').original_title, 'Account Executive');

// El AE de Madrid en inglés no pasa el gate de idioma; sí entra el de Lima cuando el mercado es abierto.
const any = await viewOf(t, rows, { market: 'any' });
assert.ok([...any.titles].includes('sales development representative'), 'en «cualquier mercado» sí entra el de Lima');
const anyFamilies = {};
for (const card of any.cards) anyFamilies[card.role] = (anyFamilies[card.role] ?? 0) + 1;
assert.equal(anyFamilies.account_executive, 1, 'el AE en inglés no entra aunque el mercado sea abierto: el gate de idioma sigue mandando');
assert.equal(anyFamilies.sdr, 1, 'el SDR de Lima sí se cuenta en «cualquier mercado»');

// El shim entrega las filas tal cual: la vista no recibe una base de verdad y no se inventa nada.
const shim = shimFor([{ source: 'x', title: 'Closer', location: 'Madrid', body: spanishBody }]);
const { results } = await shim.DB.prepare('').bind().all();
assert.equal(results.length, 1);
assert.equal(JSON.parse(results[0].payload).title, 'Closer');
assert.equal(results[0].source, 'x');

console.log('PASS  informe de rol: la elegibilidad se mide con studentSurface y el AE aparece');
