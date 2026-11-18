// El panel dice dónde se filtra un BDR, y es verdad (2026-11-13: ADR/BDR son setter).
// Antes el desplegable seguía ofreciendo «SDR / BDR» y la frase «bdr» devolvía sdr, así que quien
// escribía BDR recibía una búsqueda que ya no devuelve sus títulos. Esta prueba ata las tres piezas:
// la etiqueta del motor (tarjeta), la del panel (desplegable) y la frase (queryFromPhrase).
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/roleui.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLE_EVAL_ORDER, ROLE_LABELS, ROLE_OPTIONS, roleFromTitle } from '../../apps/web/lib/vocabulary.ts';
import { parsePhrase } from '../../apps/web/components/queryFromPhrase.ts';

const worker = readFileSync(fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url)), 'utf8');
const block = worker.match(/const ROLE_LABELS = \{([\s\S]*?)\};/);
assert.ok(block, 'ROLE_LABELS del motor localizado');
const engineLabels = Object.fromEntries([...block[1].matchAll(/(\w+):\s*'([^']*)'/g)].map(m => [m[1], m[2]]));
assert.deepEqual(engineLabels, ROLE_LABELS, 'la tarjeta de la alumna y el panel usan la misma etiqueta');

// El desplegable sale de las mismas dos listas: una familia sin etiqueta (o al revés) se ve aquí.
assert.deepEqual(ROLE_OPTIONS.map(o => o.value), [...ROLE_EVAL_ORDER]);
assert.deepEqual(ROLE_OPTIONS.map(o => o.label), ROLE_EVAL_ORDER.map(role => ROLE_LABELS[role]));

// Donde el panel promete encontrar un BDR es setter, y la etiqueta lo dice sin ambigüedad.
assert.equal(ROLE_LABELS.management, 'Mando comercial');
assert.ok(ROLE_OPTIONS.some(option => option.value === 'management' && option.label === 'Mando comercial'), 'el selector de la alumna ofrece Mando comercial');
assert.equal(roleFromTitle('Sales Manager'), 'management', 'el mando no se disfraza de ejecutivo comercial');
assert.match(ROLE_LABELS.setter, /ADR/, 'setter nombra ADR');
assert.match(ROLE_LABELS.setter, /BDR/, 'setter nombra BDR');
assert.doesNotMatch(ROLE_LABELS.sdr, /BDR/, 'sdr ya no promete BDR');
for (const title of ['BDR', 'ADR', 'BDR / SDR', 'Account Development Representative', 'Business Development Representative']) {
  assert.equal(roleFromTitle(title), 'setter', `${title} cae en la familia que el panel llama ${ROLE_LABELS.setter}`);
}

// La frase tiene que llevar a la MISMA familia que el desplegable, y decirlo.
const base = { role: null, market: 'any', days: 7, include_bilingual: false, modality: 'any', sales_motion: 'any' };
const phrase = text => parsePhrase(text, base);
for (const text of ['bdr', 'BDR en España', 'busco un adr', 'qué hay de business development representative']) {
  const result = phrase(text);
  assert.equal(result.query.role, 'setter', `«${text}» filtra setter`);
  assert.ok(result.matched.includes(`perfil ${ROLE_LABELS.setter}`), `«${text}» dice el filtro aplicado: ${result.matched.join(' · ')}`);
}
assert.equal(phrase('bdr en España').query.market, 'ES', 'y el mercado se sigue entendiendo');
// SDR sigue siendo sdr: no se ha movido de sitio, solo se le quitó el BDR de la etiqueta.
assert.equal(phrase('sdr').query.role, 'sdr');
assert.ok(phrase('sdr').matched.includes(`perfil ${ROLE_LABELS.sdr}`));
// Una oferta de closer no se traga por «bdr» ni al revés.
assert.equal(phrase('closer').query.role, 'closer');

// Modalidad y prospección son filtros PROPIOS (no una etiqueta de la oferta): la frase los aplica
// y dice cuáles, igual que el desplegable.
assert.equal(phrase('closer presencial').query.modality, 'onsite');
assert.equal(phrase('closer presencial').query.role, 'closer');
assert.equal(phrase('closer en remoto').query.modality, 'remote');
assert.equal(phrase('hibrido').query.modality, 'hybrid');
assert.ok(!phrase('closer presencial').unsupported.length, 'la modalidad ya no se rechaza: se filtra');
assert.equal(phrase('setter outbound').query.sales_motion, 'outbound');
assert.ok(phrase('setter outbound').matched.includes('prospección en frío (outbound)'), 'la frase dice qué prospección aplica');
assert.equal(phrase('ofertas inbound').query.sales_motion, 'inbound');
// «Llamadas frías» sigue siendo perfil (cold caller), no dos filtros encendidos a la vez.
assert.equal(phrase('llamadas frias').query.role, 'cold_caller');
assert.equal(phrase('llamadas frias').query.sales_motion, 'any');

console.log('PASS  un BDR se filtra por donde el panel dice (etiqueta + frase + familia)');
