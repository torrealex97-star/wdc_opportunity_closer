// El panel dice dónde se filtra un BDR, y es verdad (2026-11-13: ADR/BDR son setter).
// Antes el desplegable seguía ofreciendo «SDR / BDR» y quien escribía BDR recibía una búsqueda que
// ya no devuelve sus títulos. Esta prueba ata las dos piezas que quedan tras retirar el campo de
// frase (sesión 224): la etiqueta del motor (tarjeta) y la del desplegable del panel.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/roleui.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLE_EVAL_ORDER, ROLE_LABELS, ROLE_OPTIONS, roleFromTitle } from '../../apps/web/lib/vocabulary.ts';

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

console.log('PASS  un BDR se filtra por donde el panel dice (etiqueta + desplegable)');
